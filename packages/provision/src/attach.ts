import { classifyMx, type DnsRecord, type RuleInput, type RulesetPhase, type WorkerRoute } from "@deparked/cf";
import {
  assignTurnstileWidget,
  type Domain,
  findTurnstileWidgetWithFreeSlot,
  getDomain,
  insertDomain,
  insertLedgerEntry,
  insertTurnstileWidget,
  listDomains,
  listSiteFilesByHost,
  listTurnstileWidgets,
  setDomainStatus,
  type TurnstileWidget,
  updateDomain,
  updateLedgerEntry,
} from "@deparked/db";
import {
  activeLedger,
  createOnce,
  findEntry,
  findZone,
  intentKey,
  normalizeHost,
  notInAccount,
  ownedIds,
  type ProvisionContext,
  withdrawIntent,
  workerNames,
  wouldCreate,
} from "./context";
import { inspectDomain } from "./inspect";
import type { Effect, Plan, Step, StepCheck } from "./steps";
import {
  ADDRESS_RECORD_TYPES,
  PLACEHOLDER_RECORD,
  pathExclusions,
  ruleConflictReason,
  sameRule,
  type WantedRoute,
  wantedRedirectRules,
  wantedRewriteRules,
  wantedRoutes,
} from "./wanted";

/** The three things that touch something existing. All default to the safe choice: leave it alone. */
export interface AttachOptions {
  /**
   * The host serves a website today (`DomainInspection.servesWebsite`) and Deparked may take the address over.
   * Nothing of the site is changed or deleted, and Turn off brings it back. Default false: the attach stops
   * before its first change and asks.
   */
  takeOverLiveSite?: boolean;
  /**
   * An existing Worker route with exactly one of Deparked's patterns may be pointed at Deparked. The original
   * target is remembered and Turn off puts it back. Default false: the attach stops and asks.
   */
  repointExistingRoutes?: boolean;
  /**
   * Cloudflare's email service may replace the domain's existing mail records. They are remembered and Turn off
   * puts them back. Default false: mail stays as it is and offers are sent from another managed domain.
   */
  replaceExistingMx?: boolean;
}

const blocked = (reason: string): StepCheck => ({ status: "blocked", reason });
const needed = (effects: Effect[]): StepCheck => ({ status: "needed", effects });
const done = (effects: Effect[] = []): StepCheck => ({ status: "done", effects });
const hasWork = (effects: Effect[]) => effects.some((effect) => effect.kind !== "reuse");

function sameRouteReason(routes: readonly WorkerRoute[]): string {
  const list = routes.map((route) => `${route.pattern} (${route.script ?? "no Worker"})`).join(", ");
  return `Another Worker already answers on ${list}. Confirm that Deparked may take over that address. The original is remembered, and Turn off puts it back.`;
}

const NO_PUBLISHER = "The placeholder page cannot be published: this setup was started without a publisher.";

/** Stops before anything changes when the domain cannot be attached, then remembers the domain and its zone. */
function registerStep(host: string, options: AttachOptions): Step {
  return {
    id: "register",
    title: "Check the domain",
    async check(ctx) {
      if (ctx.publishPlaceholder === undefined) return blocked(NO_PUBLISHER);
      const inspection = await inspectDomain(ctx, host);
      if (inspection.zone === null || inspection.blockers.length > 0) return blocked(inspection.blockers.join(" "));
      const isOn = inspection.managed === "placeholder" || inspection.managed === "live";
      if (inspection.servesWebsite && !isOn && options.takeOverLiveSite !== true) {
        return blocked(
          `${host} shows a website today. Confirm that Deparked may take over ${host}: visitors then get the for-sale page instead. Your site and its settings stay untouched, and Turn off brings it back.`,
        );
      }
      if (inspection.sameRoutePatterns.length > 0 && options.repointExistingRoutes !== true) {
        return blocked(sameRouteReason(inspection.sameRoutePatterns));
      }
      const row = await getDomain(ctx.db, host);
      if (row?.zoneId === inspection.zone.id) return done([{ kind: "reuse", what: `${host} in Deparked's list` }]);
      return needed([{ kind: "create", what: `${host} in Deparked's list` }]);
    },
    async run(ctx) {
      const [zone] = await ctx.cf.zones.list({ name: host });
      if (zone === undefined) throw new Error(notInAccount(host));
      // `off` until the last step: nothing answers on the domain yet, and the ledger needs the row to exist.
      const inserted = await insertDomain(ctx.db, {
        domain: { host, zoneId: zone.id, status: "off" },
        now: ctx.now(),
      });
      if (inserted === undefined) await updateDomain(ctx.db, { host, patch: { zoneId: zone.id }, now: ctx.now() });
      return { effects: [{ kind: "create", what: `${host} in Deparked's list` }] };
    },
  };
}

/**
 * The page must be there before any route or rule sends visitors to it: a domain that serves a site today
 * would otherwise answer with an error until the first publish.
 */
function publishPlaceholderStep(host: string): Step {
  const what = `a placeholder page for ${host}`;
  return {
    id: "publish-placeholder",
    title: "Publish the placeholder page",
    async check(ctx) {
      if (ctx.publishPlaceholder === undefined) return blocked(NO_PUBLISHER);
      const files = await listSiteFilesByHost(ctx.db, host);
      const published = files.some((file) => file.path === `/sites/${host}/index.html`);
      return published ? done([{ kind: "reuse", what }]) : needed([{ kind: "create", what }]);
    },
    async run(ctx) {
      if (ctx.publishPlaceholder === undefined) throw new Error(NO_PUBLISHER);
      await ctx.publishPlaceholder(host);
      return { effects: [{ kind: "create", what }] };
    },
  };
}

/**
 * `create`: no route has the pattern. `repoint`: the pattern goes somewhere else. `reuse`: an existing route
 * that is not in the ledger already goes to Deparked's Worker; it stays the owner's and nothing is recorded.
 */
type RouteAction = "create" | "repoint" | "reuse" | "none";

interface RouteItem extends WantedRoute {
  existing: WorkerRoute | undefined;
  action: RouteAction;
}

const TARGET_WORDS = { sites: "Deparked's pages", admin: "the Deparked admin" } as const;

function routeEffect(item: RouteItem): Effect {
  const to = TARGET_WORDS[item.target];
  if (item.action === "create") return { kind: "create", what: `${item.pattern} is answered by ${to}` };
  if (item.action === "repoint") {
    return {
      kind: "change",
      what: `${item.pattern} moves from ${item.existing?.script ?? "no Worker"} to ${to} (the original is remembered)`,
    };
  }
  return { kind: "reuse", what: `${item.pattern} already goes to ${to}` };
}

function routesStep(host: string, options: AttachOptions): Step {
  async function items(ctx: ProvisionContext, zoneId: string) {
    const routes = await ctx.cf.zones.listRoutes(zoneId);
    const ledger = await activeLedger(ctx, host);
    const owned = ownedIds(ledger, "route");
    const list = wantedRoutes(host, workerNames(ctx)).map((wanted): RouteItem => {
      const existing = routes.find((route) => route.pattern === wanted.pattern);
      let action: RouteAction = "none";
      if (existing !== undefined && existing.script !== wanted.script) action = "repoint";
      else if (existing === undefined || !owned.has(existing.id)) {
        const lookAlikes = existing === undefined ? [] : [existing.id];
        action = wouldCreate(ledger, "route", wanted.pattern, lookAlikes) ? "create" : "reuse";
      }
      return { ...wanted, existing, action };
    });
    return { list, ledger };
  }

  return {
    id: "routes",
    title: "Point the address at Deparked",
    async check(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) return blocked(notInAccount(host));
      const { list } = await items(ctx, zone.id);
      const taken = list.filter((item) => item.action === "repoint").flatMap((item) => item.existing ?? []);
      if (taken.length > 0 && options.repointExistingRoutes !== true) return blocked(sameRouteReason(taken));
      const effects = list.map(routeEffect);
      return hasWork(effects) ? needed(effects) : done(effects);
    },
    async run(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) throw new Error(notInAccount(host));
      const { list, ledger } = await items(ctx, zone.id);
      for (const item of list) {
        if (item.action === "create") {
          await createOnce(ctx, {
            entries: ledger,
            host,
            zoneId: zone.id,
            resource: "route",
            key: item.pattern,
            lookAlikes: item.existing === undefined ? [] : [item.existing.id],
            create: async () =>
              (await ctx.cf.zones.createRoute(zone.id, { pattern: item.pattern, script: item.script })).id,
          });
        } else if (item.action === "repoint" && item.existing !== undefined) {
          if (options.repointExistingRoutes !== true) throw new Error(sameRouteReason([item.existing]));
          // The original target is written down before the change, so a failure in between cannot lose it.
          if (findEntry(ledger, "route", item.existing.id) === undefined) {
            await insertLedgerEntry(ctx.db, {
              host,
              zoneId: zone.id,
              resource: "route",
              cfId: item.existing.id,
              action: "changed",
              previousJson: JSON.stringify({ pattern: item.existing.pattern, script: item.existing.script ?? null }),
              now: ctx.now(),
            });
          }
          await ctx.cf.zones.updateRoute(zone.id, item.existing.id, { pattern: item.pattern, script: item.script });
        }
      }
      return { effects: list.map(routeEffect) };
    },
  };
}

/**
 * Appends Deparked's rules to a phase's list; other rules stay. A rule is Deparked's only when the ledger names
 * its id. A rule of the owner's with the same description is never adopted: when it does exactly the same it
 * is reused as it is, when it does something else the step stops.
 */
function rulesStep(input: {
  id: string;
  title: string;
  host: string;
  phase: RulesetPhase;
  /** The wanted rules. The rewrite rules depend on the owner's routes, hence the zone. */
  rules: (ctx: ProvisionContext, zoneId: string) => Promise<RuleInput[]>;
  words: (rule: RuleInput) => string;
}): Step {
  const { host, phase } = input;

  async function items(ctx: ProvisionContext, zoneId: string) {
    const wanted = await input.rules(ctx, zoneId);
    const existing = (await ctx.cf.rulesets.getEntrypoint(zoneId, phase))?.rules ?? [];
    const ledger = await activeLedger(ctx, host);
    const owned = ownedIds(ledger, "rule");
    const list = wanted.map((rule) => {
      const named = existing.filter((entry) => entry.description === rule.description);
      const twins = named.filter((entry) => !owned.has(entry.id));
      const ours = named.some((entry) => owned.has(entry.id));
      const lookAlikes = twins.map((entry) => entry.id);
      const create = !ours && wouldCreate(ledger, "rule", rule.description, lookAlikes);
      const conflict = !ours && twins.some((entry) => !sameRule(entry, rule));
      return { rule, lookAlikes, create, conflict, ours };
    });
    return { list, ledger };
  }

  const effect = (item: { rule: RuleInput; create: boolean }): Effect => ({
    kind: item.create ? "create" : "reuse",
    what: input.words(item.rule),
  });

  return {
    id: input.id,
    title: input.title,
    async check(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) return blocked(notInAccount(host));
      const { list } = await items(ctx, zone.id);
      const conflict = list.find((item) => item.conflict);
      if (conflict !== undefined) return blocked(ruleConflictReason(host, conflict.rule.description));
      const effects = list.map(effect);
      return hasWork(effects) ? needed(effects) : done(effects);
    },
    async run(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) throw new Error(notInAccount(host));
      const { list, ledger } = await items(ctx, zone.id);
      for (const item of list) {
        if (item.conflict) throw new Error(ruleConflictReason(host, item.rule.description));
        if (!item.create) continue;
        await createOnce(ctx, {
          entries: ledger,
          host,
          zoneId: zone.id,
          resource: "rule",
          key: item.rule.description,
          lookAlikes: item.lookAlikes,
          create: async () => (await ctx.cf.rulesets.addRule(zone.id, phase, item.rule)).rule.id,
        });
      }
      return { effects: list.map(effect) };
    },
  };
}

const isPlaceholder = (record: DnsRecord) =>
  record.type === PLACEHOLDER_RECORD.type && record.content === PLACEHOLDER_RECORD.content && record.proxied === true;

/**
 * A hostname with no address record gets a proxied placeholder. An existing record is never edited. `www` is
 * left alone when a wildcard record covers it, unless taking over the live site was confirmed.
 */
function dnsStep(host: string, options: AttachOptions): Step {
  type Item = { name: string; action: "create" | "reuse" | "none"; note: string; lookAlikes: string[] };

  async function items(ctx: ProvisionContext, zoneId: string) {
    const ledger = await activeLedger(ctx, host);
    const owned = ownedIds(ledger, "dns_record");
    const address = async (name: string) =>
      (await ctx.cf.zones.listDnsRecords(zoneId, { name })).filter((record) =>
        ADDRESS_RECORD_TYPES.includes(record.type),
      );
    const list: Item[] = [];
    for (const name of [host, `www.${host}`]) {
      const records = await address(name);
      const item: Item = { name, action: "reuse", note: "", lookAlikes: [] };
      if (records.some((record) => owned.has(record.id))) item.action = "none";
      else if (records.length > 0) {
        // Only a lone placeholder can be the record an earlier, unconfirmed try created.
        item.lookAlikes = records.length === 1 ? records.filter(isPlaceholder).map((record) => record.id) : [];
        const adopt = item.lookAlikes.length === 1 && wouldCreate(ledger, "dns_record", name, item.lookAlikes);
        item.action = adopt ? "create" : "reuse";
        if (records.some((record) => record.proxied === false)) {
          item.note = " (it does not go through Cloudflare, so Deparked cannot answer there)";
        }
      } else if (name !== host && options.takeOverLiveSite !== true && (await address(`*.${host}`)).length > 0) {
        item.note = " (your wildcard record covers it)";
      } else item.action = "create";
      list.push(item);
    }
    return { list, ledger };
  }

  const effect = (item: Item): Effect =>
    item.action === "create"
      ? { kind: "create", what: `an address record for ${item.name} that goes through Cloudflare` }
      : { kind: "reuse", what: `the address of ${item.name} stays as it is${item.note}` };

  return {
    id: "dns",
    title: "Make the address reachable",
    async check(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) return blocked(notInAccount(host));
      const effects = (await items(ctx, zone.id)).list.map(effect);
      return hasWork(effects) ? needed(effects) : done(effects);
    },
    async run(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) throw new Error(notInAccount(host));
      const { list, ledger } = await items(ctx, zone.id);
      for (const item of list) {
        if (item.action === "reuse") await withdrawIntent(ctx, ledger, "dns_record", item.name);
        if (item.action !== "create") continue;
        await createOnce(ctx, {
          entries: ledger,
          host,
          zoneId: zone.id,
          resource: "dns_record",
          key: item.name,
          lookAlikes: item.lookAlikes,
          create: async () =>
            (await ctx.cf.zones.createDnsRecord(zone.id, { ...PLACEHOLDER_RECORD, name: item.name, proxied: true })).id,
        });
      }
      return { effects: list.map(effect) };
    },
  };
}

const WIDGET_NAME = /^deparked-(\d+)$/;
const SECRET_PREFIX = "TURNSTILE_SECRET_";

function widgetNumber(name: string): number {
  return Number(WIDGET_NAME.exec(name)?.[1] ?? 0);
}

/**
 * A new widget `deparked-N` with its secret on the admin Worker as `TURNSTILE_SECRET_<N>`. The secret's ledger
 * entry (hub level) is written before the widget is created; when it is found without an id on a retry, a
 * widget of that name which the database does not know is the one the earlier try created, and is finished.
 * Any other unknown widget is not Deparked's and is never touched: the new one gets a number no widget uses.
 */
async function createWidget(ctx: ProvisionContext, host: string): Promise<Pick<TurnstileWidget, "sitekey" | "name">> {
  const remote = await ctx.cf.turnstile.list();
  const known = await listTurnstileWidgets(ctx.db);
  const nameOf = (secretName: string) => `deparked-${secretName.slice(SECRET_PREFIX.length)}`;
  let pending = (await activeLedger(ctx, null)).find(
    (entry) => entry.resource === "secret" && entry.cfId === null && intentKey(entry) !== null,
  );
  let secretName = pending === undefined ? undefined : (intentKey(pending) ?? undefined);
  if (
    pending !== undefined &&
    secretName !== undefined &&
    known.some((widget) => widget.name === nameOf(secretName ?? ""))
  ) {
    // The earlier try got as far as the database: only its entry was left open.
    await updateLedgerEntry(ctx.db, { id: pending.id, cfId: secretName });
    pending = undefined;
    secretName = undefined;
  }
  const taken = [...known, ...remote].map((widget) => widgetNumber(widget.name));
  secretName ??= `${SECRET_PREFIX}${Math.max(0, ...taken) + 1}`;
  const name = nameOf(secretName);
  const earlier =
    pending === undefined
      ? []
      : remote.filter((widget) => widget.name === name && !known.some((entry) => entry.sitekey === widget.sitekey));
  if (earlier.length > 1) throw new Error(`Cloudflare has several bot checks named ${name}. Remove the unused ones.`);
  const entry =
    pending ??
    (await insertLedgerEntry(ctx.db, {
      resource: "secret",
      action: "created",
      previousJson: JSON.stringify({ intent: secretName }),
      now: ctx.now(),
    }));
  const sitekey = earlier[0]?.sitekey ?? (await ctx.cf.turnstile.create({ name, domains: [host] })).sitekey;
  await ctx.cf.workers.putSecret(workerNames(ctx).admin, secretName, await ctx.cf.turnstile.getSecret(sitekey));
  await insertTurnstileWidget(ctx.db, { sitekey, name, secretName, now: ctx.now() });
  await updateLedgerEntry(ctx.db, { id: entry.id, cfId: secretName });
  return { sitekey, name };
}

/**
 * One hostname place in a Turnstile widget. Widgets hold 10 hostnames and fill up one after another; when all
 * are full a new one is created. The place is taken in the database first, in one statement together with
 * `domains.turnstile_widget_id`, so a retry sees it and never takes a second one. Cloudflare's hostname list
 * is read again right before it is written and the host is only added when it is missing.
 */
function botCheckStep(host: string): Step {
  return {
    id: "bot-check",
    title: "Protect the offer form from bots",
    async check(ctx) {
      const row = await getDomain(ctx.db, host);
      const widgets = await listTurnstileWidgets(ctx.db);
      const current = widgets.find((widget) => widget.sitekey === row?.turnstileWidgetId);
      if (current !== undefined) {
        const told = findEntry(await activeLedger(ctx, host), "turnstile_hostname", current.sitekey) !== undefined;
        const what = `${host}'s place in the bot check ${current.name}`;
        return told ? done([{ kind: "reuse", what }]) : needed([{ kind: "change", what }]);
      }
      const free = await findTurnstileWidgetWithFreeSlot(ctx.db);
      if (free !== undefined) return needed([{ kind: "change", what: `${host} joins the bot check ${free.name}` }]);
      const name = `deparked-${Math.max(0, ...widgets.map((widget) => widgetNumber(widget.name))) + 1}`;
      return needed([
        { kind: "create", what: `a new bot check ${name} for ${host}` },
        { kind: "create", what: `the secret key of ${name}, stored on the admin` },
      ]);
    },
    async run(ctx) {
      const effects: Effect[] = [];
      let sitekey: string | null = null;
      for (let attempt = 0; attempt < 25 && sitekey === null; attempt += 1) {
        const row = await getDomain(ctx.db, host);
        if (row === undefined) throw new Error(notInAccount(host));
        sitekey = row.turnstileWidgetId;
        if (sitekey !== null) break;
        let widget: Pick<TurnstileWidget, "sitekey" | "name"> | undefined = await findTurnstileWidgetWithFreeSlot(
          ctx.db,
        );
        if (widget === undefined) {
          widget = await createWidget(ctx, host);
          effects.push({ kind: "create", what: `a new bot check ${widget.name} for ${host}` });
          effects.push({ kind: "create", what: `the secret key of ${widget.name}, stored on the admin` });
        }
        // False when someone else took the last place meanwhile: look for another widget.
        if (await assignTurnstileWidget(ctx.db, { host, sitekey: widget.sitekey, now: ctx.now() })) {
          sitekey = widget.sitekey;
        }
      }
      if (sitekey === null) throw new Error(`No bot check has a free place for ${host}.`);

      const held = sitekey;
      const widget = (await ctx.cf.turnstile.list()).find((entry) => entry.sitekey === held);
      if (widget === undefined) throw new Error(`The bot check of ${host} no longer exists in Cloudflare.`);
      if (!widget.domains.includes(host)) await ctx.cf.turnstile.updateHostnames(widget, [...widget.domains, host]);
      if (findEntry(await activeLedger(ctx, host), "turnstile_hostname", held) === undefined) {
        await insertLedgerEntry(ctx.db, {
          host,
          resource: "turnstile_hostname",
          cfId: held,
          action: "created",
          now: ctx.now(),
        });
      }
      effects.push({ kind: "change", what: `${host} joined the bot check ${widget.name}` });
      return { effects };
    },
  };
}

function analyticsStep(host: string): Step {
  const what = `visitor statistics for ${host}`;
  async function sites(ctx: ProvisionContext) {
    const ledger = await activeLedger(ctx, host);
    const owned = ownedIds(ledger, "analytics_site");
    const all = (await ctx.cf.analytics.listSites()).filter((site) => site.host === host);
    const ours = all.find((site) => owned.has(site.siteTag));
    return { ledger, ours, others: all.filter((site) => !owned.has(site.siteTag)) };
  }
  return {
    id: "analytics",
    title: "Count visits",
    async check(ctx) {
      const row = await getDomain(ctx.db, host);
      if (row !== undefined && row.analyticsSiteTag !== null) return done([{ kind: "reuse", what }]);
      const { ledger, ours, others } = await sites(ctx);
      const create =
        ours === undefined &&
        wouldCreate(
          ledger,
          "analytics_site",
          host,
          others.map((site) => site.siteTag),
        );
      return needed([{ kind: create ? "create" : "reuse", what }]);
    },
    async run(ctx) {
      if ((await getDomain(ctx.db, host)) === undefined) throw new Error(notInAccount(host));
      const { ledger, ours, others } = await sites(ctx);
      let site = ours;
      let kind: Effect["kind"] = "reuse";
      if (site === undefined) {
        const fresh: (typeof others)[number][] = [];
        const result = await createOnce(ctx, {
          entries: ledger,
          host,
          resource: "analytics_site",
          key: host,
          lookAlikes: others.map((entry) => entry.siteTag),
          create: async () => {
            const created = await ctx.cf.analytics.createSite(host);
            fresh.push(created);
            return created.siteTag;
          },
        });
        site = fresh[0] ?? others.find((entry) => entry.siteTag === result.cfId);
        if (result.outcome === "created") kind = "create";
      }
      if (site === undefined) throw new Error(`The visitor statistics for ${host} could not be found again.`);
      await updateDomain(ctx.db, {
        host,
        patch: { analyticsSiteTag: site.siteTag, analyticsBeaconToken: site.siteToken ?? null },
        now: ctx.now(),
      });
      return { effects: [{ kind, what }] };
    },
  };
}

/**
 * Where a domain that keeps its own mail sends offers from: another managed domain with Cloudflare's email
 * service on. The current choice is kept while it still qualifies. Null when there is none.
 */
export function pickSenderHost(domains: readonly Domain[], host: string, current: string | null): string | null {
  const candidates = domains
    .filter(
      (domain) =>
        domain.host !== host &&
        domain.emailRoutingState === "enabled" &&
        (domain.status === "placeholder" || domain.status === "live"),
    )
    .map((domain) => domain.host);
  if (current !== null && candidates.includes(current)) return current;
  return candidates[0] ?? null;
}

const senderWords = (sender: string | null) =>
  sender === null
    ? "offers are saved in the admin; no other domain can send the emails yet"
    : `offer emails are sent from offers@${sender}`;

const ENABLE = "enable";

type EmailCase =
  | { kind: "settled" }
  | { kind: "keep"; sender: string | null }
  | { kind: "use-existing" }
  | { kind: "enable" }
  | { kind: "replace"; mx: { name: string; content: string; priority: number | null; ttl: number | null }[] };

/** Email Routing after the MX check. Existing mail is only replaced when the owner confirmed it. */
function emailStep(host: string, options: AttachOptions): Step {
  async function decide(ctx: ProvisionContext, row: Domain | undefined, zoneId: string): Promise<EmailCase> {
    const replace = options.replaceExistingMx === true;
    if (row?.emailRoutingState === "enabled") return { kind: "settled" };
    if (row?.emailRoutingState === "kept_external" && !replace) {
      const sender = pickSenderHost(await listDomains(ctx.db), host, row.senderHost);
      return sender === row.senderHost ? { kind: "settled" } : { kind: "keep", sender };
    }
    const mx = await ctx.cf.zones.listDnsRecords(zoneId, { type: "MX", name: host });
    const state = classifyMx(mx, host);
    if (state === "external") {
      if (!replace) return { kind: "keep", sender: pickSenderHost(await listDomains(ctx.db), host, null) };
      return {
        kind: "replace",
        mx: mx.map((record) => ({
          name: record.name,
          content: record.content ?? "",
          priority: record.priority ?? null,
          ttl: record.ttl ?? null,
        })),
      };
    }
    // Routing that is on although Deparked only announced turning it on: the earlier call worked after all.
    const announced = wouldCreate(await activeLedger(ctx, host), "email_routing", ENABLE, [zoneId]);
    const routing = await ctx.cf.email.getRouting(zoneId);
    return routing.enabled && !announced ? { kind: "use-existing" } : { kind: "enable" };
  }

  function effect(decision: EmailCase): Effect {
    switch (decision.kind) {
      case "settled":
      case "use-existing":
        return { kind: "reuse", what: `email for ${host} is already set up` };
      case "keep":
        return {
          kind: "reuse",
          what: `your existing mail for ${host} stays as it is; ${senderWords(decision.sender)}`,
        };
      case "enable":
        return { kind: "create", what: `Cloudflare's email service for ${host}, so offers come from offers@${host}` };
      case "replace":
        return {
          kind: "change",
          what: `mail for ${host} moves to Cloudflare's email service (the current mail records are remembered)`,
        };
    }
  }

  return {
    id: "email",
    title: "Set up the sender of offer emails",
    async check(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) return blocked(notInAccount(host));
      const decision = await decide(ctx, await getDomain(ctx.db, host), zone.id);
      return decision.kind === "settled" ? done([effect(decision)]) : needed([effect(decision)]);
    },
    async run(ctx) {
      const row = await getDomain(ctx.db, host);
      if (row === undefined) throw new Error(notInAccount(host));
      const zone = { id: row.zoneId, name: host };
      const decision = await decide(ctx, row, zone.id);
      const entry = { host, zoneId: zone.id, resource: "email_routing" as const, cfId: zone.id };
      if (decision.kind === "settled") return { effects: [effect(decision)] };
      if (decision.kind === "keep") {
        await updateDomain(ctx.db, {
          host,
          patch: { emailRoutingState: "kept_external", senderHost: decision.sender },
          now: ctx.now(),
        });
        return { effects: [effect(decision)] };
      }
      if (decision.kind === "enable") {
        const enabled = (await ctx.cf.email.getRouting(zone.id)).enabled;
        await createOnce(ctx, {
          entries: await activeLedger(ctx, host),
          host,
          zoneId: zone.id,
          resource: "email_routing",
          key: ENABLE,
          lookAlikes: enabled ? [zone.id] : [],
          create: async () => {
            await ctx.cf.email.enableRouting(zone, { replaceExistingMx: false });
            return zone.id;
          },
        });
      }
      if (decision.kind === "replace") {
        // The mail records are written down before they are replaced, so a failure in between cannot lose them.
        if (findEntry(await activeLedger(ctx, host), "email_routing", zone.id) === undefined) {
          await insertLedgerEntry(ctx.db, {
            ...entry,
            action: "changed",
            previousJson: JSON.stringify({ mx: decision.mx }),
            now: ctx.now(),
          });
        }
        await ctx.cf.email.enableRouting(zone, { replaceExistingMx: true });
      }
      await updateDomain(ctx.db, { host, patch: { emailRoutingState: "enabled", senderHost: host }, now: ctx.now() });
      return { effects: [effect(decision)] };
    },
  };
}

function readyStep(host: string): Step {
  const isOn = (row: Domain | undefined) => row?.status === "placeholder" || row?.status === "live";
  const what = `${host} is set up and shows its placeholder page`;
  return {
    id: "ready",
    title: "Finish",
    async check(ctx) {
      return isOn(await getDomain(ctx.db, host)) ? done() : needed([{ kind: "change", what }]);
    },
    async run(ctx) {
      const row = await setDomainStatus(ctx.db, { host, status: "placeholder", now: ctx.now() });
      if (row === undefined) throw new Error(notInAccount(host));
      return { effects: [{ kind: "change", what }] };
    },
  };
}

/**
 * The steps that attach a domain, in order. Building the plan does no I/O, so the admin rebuilds it on every
 * request from the host and the confirmations. Turning a domain on again is the same plan.
 *
 * Nothing a visitor can notice changes before the placeholder page is published: the routes, rules and
 * records come after it.
 */
export function planAttachDomain(ctx: ProvisionContext, hostInput: string, options: AttachOptions = {}): Plan {
  const host = normalizeHost(hostInput);
  return {
    kind: "attach",
    host,
    ctx,
    steps: [
      registerStep(host, options),
      botCheckStep(host),
      analyticsStep(host),
      emailStep(host, options),
      publishPlaceholderStep(host),
      routesStep(host, options),
      rulesStep({
        id: "rewrite",
        title: "Show this domain's page to visitors",
        host,
        phase: "http_request_transform",
        async rules(ctx, zoneId) {
          const owned = ownedIds(await activeLedger(ctx, host), "route");
          const wanted = wantedRoutes(host, workerNames(ctx));
          const theirs = (await ctx.cf.zones.listRoutes(zoneId)).filter(
            (route) => !owned.has(route.id) && !wanted.some((entry) => entry.pattern === route.pattern),
          );
          const { exclusions, inexpressible } = pathExclusions(theirs, host);
          if (inexpressible.length > 0) {
            throw new Error(`The Worker route ${inexpressible[0]?.pattern} cannot be left out of Deparked's rule.`);
          }
          return wantedRewriteRules(host, exclusions);
        },
        words: (rule) =>
          rule.description.endsWith("home page")
            ? `a rule that shows ${host}'s page at ${host}/`
            : `a rule that serves ${host}'s files (not /catalog/, /admin, /api/ or your own Workers' paths)`,
      }),
      rulesStep({
        id: "www-redirect",
        title: "Send www to the main address",
        host,
        phase: "http_request_dynamic_redirect",
        rules: async () => wantedRedirectRules(host),
        words: () => `a rule that sends www.${host} to ${host}`,
      }),
      dnsStep(host, options),
      readyStep(host),
    ],
  };
}
