import { classifyMx, type RuleInput, type RulesetPhase, type WorkerRoute } from "@deparked/cf";
import {
  claimTurnstileSlot,
  type Domain,
  findTurnstileWidgetWithFreeSlot,
  getDomain,
  insertDomain,
  insertLedgerEntry,
  insertTurnstileWidget,
  listDomains,
  listTurnstileWidgets,
  setDomainStatus,
  TURNSTILE_HOSTNAMES_PER_WIDGET,
  updateDomain,
} from "@deparked/db";
import {
  activeLedger,
  findEntry,
  findZone,
  normalizeHost,
  notInAccount,
  type ProvisionContext,
  workerNames,
} from "./context";
import { inspectDomain } from "./inspect";
import type { Effect, Plan, Step, StepCheck } from "./steps";
import {
  ADDRESS_RECORD_TYPES,
  PLACEHOLDER_RECORD,
  type WantedRoute,
  wantedRedirectRules,
  wantedRewriteRules,
  wantedRoutes,
} from "./wanted";

/** The two things that touch something existing. Both default to the safe choice: leave it alone. */
export interface AttachOptions {
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

/** Stops before anything changes when the domain cannot be attached, then remembers the domain and its zone. */
function registerStep(host: string, options: AttachOptions): Step {
  return {
    id: "register",
    title: "Check the domain",
    async check(ctx) {
      const inspection = await inspectDomain(ctx, host);
      if (inspection.zone === null || inspection.blockers.length > 0) return blocked(inspection.blockers.join(" "));
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

type RouteAction = "create" | "repoint" | "record" | "none";

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
  async function items(ctx: ProvisionContext, zoneId: string): Promise<RouteItem[]> {
    const routes = await ctx.cf.zones.listRoutes(zoneId);
    const ledger = await activeLedger(ctx, host);
    return wantedRoutes(host, workerNames(ctx)).map((wanted) => {
      const existing = routes.find((route) => route.pattern === wanted.pattern);
      let action: RouteAction = "create";
      if (existing !== undefined && existing.script !== wanted.script) action = "repoint";
      else if (existing !== undefined)
        action = findEntry(ledger, "route", existing.id) === undefined ? "record" : "none";
      return { ...wanted, existing, action };
    });
  }

  return {
    id: "routes",
    title: "Point the address at Deparked",
    async check(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) return blocked(notInAccount(host));
      const list = await items(ctx, zone.id);
      const taken = list.filter((item) => item.action === "repoint").flatMap((item) => item.existing ?? []);
      if (taken.length > 0 && options.repointExistingRoutes !== true) return blocked(sameRouteReason(taken));
      const effects = list.map(routeEffect);
      return list.every((item) => item.action === "none") ? done(effects) : needed(effects);
    },
    async run(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) throw new Error(notInAccount(host));
      const list = await items(ctx, zone.id);
      const ledger = await activeLedger(ctx, host);
      const entry = { host, zoneId: zone.id, resource: "route" as const };
      for (const item of list) {
        if (item.action === "create") {
          const route = await ctx.cf.zones.createRoute(zone.id, { pattern: item.pattern, script: item.script });
          await insertLedgerEntry(ctx.db, { ...entry, cfId: route.id, action: "created", now: ctx.now() });
        } else if (item.action === "record" && item.existing !== undefined) {
          // The route points at Deparked but an earlier run did not get to write it down.
          await insertLedgerEntry(ctx.db, { ...entry, cfId: item.existing.id, action: "created", now: ctx.now() });
        } else if (item.action === "repoint" && item.existing !== undefined) {
          if (options.repointExistingRoutes !== true) throw new Error(sameRouteReason([item.existing]));
          // The original target is written down before the change, so a failure in between cannot lose it.
          if (findEntry(ledger, "route", item.existing.id) === undefined) {
            await insertLedgerEntry(ctx.db, {
              ...entry,
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

/** Appends Deparked's rules to a phase's list. A rule is recognised by its description; other rules stay. */
function rulesStep(input: {
  id: string;
  title: string;
  host: string;
  phase: RulesetPhase;
  rules: RuleInput[];
  words: (rule: RuleInput) => string;
}): Step {
  const { host, phase } = input;

  async function items(ctx: ProvisionContext, zoneId: string) {
    const existing = (await ctx.cf.rulesets.getEntrypoint(zoneId, phase))?.rules ?? [];
    const ledger = await activeLedger(ctx, host);
    return input.rules.map((rule) => {
      const found = existing.find((entry) => entry.description === rule.description);
      const recorded = found !== undefined && findEntry(ledger, "rule", found.id) !== undefined;
      return { rule, found, recorded };
    });
  }

  return {
    id: input.id,
    title: input.title,
    async check(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) return blocked(notInAccount(host));
      const list = await items(ctx, zone.id);
      const effects = list.map(
        (item): Effect => ({ kind: item.found === undefined ? "create" : "reuse", what: input.words(item.rule) }),
      );
      return list.every((item) => item.recorded) ? done(effects) : needed(effects);
    },
    async run(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) throw new Error(notInAccount(host));
      const effects: Effect[] = [];
      for (const item of await items(ctx, zone.id)) {
        const what = input.words(item.rule);
        effects.push({ kind: item.found === undefined ? "create" : "reuse", what });
        if (item.recorded) continue;
        const ruleId = item.found?.id ?? (await ctx.cf.rulesets.addRule(zone.id, phase, item.rule)).rule.id;
        await insertLedgerEntry(ctx.db, {
          host,
          zoneId: zone.id,
          resource: "rule",
          cfId: ruleId,
          action: "created",
          now: ctx.now(),
        });
      }
      return { effects };
    },
  };
}

/** A hostname with no address record gets a proxied placeholder. An existing record is never edited. */
function dnsStep(host: string): Step {
  async function items(ctx: ProvisionContext, zoneId: string) {
    const list = [];
    for (const name of [host, `www.${host}`]) {
      const records = await ctx.cf.zones.listDnsRecords(zoneId, { name });
      const address = records.filter((record) => ADDRESS_RECORD_TYPES.includes(record.type));
      list.push({ name, missing: address.length === 0, direct: address.some((record) => record.proxied === false) });
    }
    return list;
  }

  const effect = (item: { name: string; missing: boolean; direct: boolean }): Effect => {
    if (item.missing)
      return { kind: "create", what: `an address record for ${item.name} that goes through Cloudflare` };
    const note = item.direct ? " (it does not go through Cloudflare, so Deparked cannot answer there)" : "";
    return { kind: "reuse", what: `the address record of ${item.name} stays as it is${note}` };
  };

  return {
    id: "dns",
    title: "Make the address reachable",
    async check(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) return blocked(notInAccount(host));
      const list = await items(ctx, zone.id);
      const effects = list.map(effect);
      return hasWork(effects) ? needed(effects) : done(effects);
    },
    async run(ctx) {
      const zone = await findZone(ctx, host);
      if (zone === null) throw new Error(notInAccount(host));
      const list = await items(ctx, zone.id);
      for (const item of list) {
        if (!item.missing) continue;
        const record = await ctx.cf.zones.createDnsRecord(zone.id, {
          ...PLACEHOLDER_RECORD,
          name: item.name,
          proxied: true,
        });
        await insertLedgerEntry(ctx.db, {
          host,
          zoneId: zone.id,
          resource: "dns_record",
          cfId: record.id,
          action: "created",
          now: ctx.now(),
        });
      }
      return { effects: list.map(effect) };
    },
  };
}

const WIDGET_NAME = /^deparked-(\d+)$/;

function widgetNumber(name: string): number {
  return Number(WIDGET_NAME.exec(name)?.[1] ?? 0);
}

/**
 * One hostname slot in a Turnstile widget. Widgets hold 10 hostnames and fill up one after another; a full set
 * gets a new widget `deparked-N`, whose secret goes to the admin Worker as `TURNSTILE_SECRET_<N>`.
 */
function botCheckStep(host: string): Step {
  return {
    id: "bot-check",
    title: "Protect the offer form from bots",
    async check(ctx) {
      const row = await getDomain(ctx.db, host);
      const widgets = await listTurnstileWidgets(ctx.db);
      const current = widgets.find((widget) => widget.sitekey === row?.turnstileWidgetId);
      if (current !== undefined)
        return done([{ kind: "reuse", what: `${host}'s place in the bot check ${current.name}` }]);
      const free = await findTurnstileWidgetWithFreeSlot(ctx.db);
      if (free !== undefined) {
        return needed([
          {
            kind: "change",
            what: `${host} joins the bot check ${free.name} (place ${free.hostnameCount + 1} of ${TURNSTILE_HOSTNAMES_PER_WIDGET})`,
          },
        ]);
      }
      const name = `deparked-${Math.max(0, ...widgets.map((widget) => widgetNumber(widget.name))) + 1}`;
      return needed([
        { kind: "create", what: `a new bot check ${name} for ${host}` },
        { kind: "create", what: `the secret key of ${name}, stored on the admin` },
      ]);
    },
    async run(ctx) {
      if ((await getDomain(ctx.db, host)) === undefined) throw new Error(notInAccount(host));
      const effects: Effect[] = [];
      const remote = await ctx.cf.turnstile.list();
      const known = await listTurnstileWidgets(ctx.db);
      const lists = (sitekey: string) => remote.find((widget) => widget.sitekey === sitekey)?.domains.includes(host);

      // A widget that already lists the host (an earlier try got that far), else the fullest one with a free slot.
      let sitekey = known.find((widget) => lists(widget.sitekey) === true)?.sitekey;
      if (sitekey === undefined) {
        const free = await findTurnstileWidgetWithFreeSlot(ctx.db);
        const widget = remote.find((entry) => entry.sitekey === free?.sitekey);
        if (free !== undefined && widget !== undefined) {
          await ctx.cf.turnstile.updateHostnames(widget, [...widget.domains, host]);
          sitekey = free.sitekey;
          effects.push({ kind: "change", what: `${host} joined the bot check ${free.name}` });
        }
      }
      if (sitekey === undefined) {
        // A widget Cloudflare has but the database does not is an earlier try that failed before the secret was
        // stored: it is finished instead of creating a second one.
        const orphan = remote.find(
          (widget) =>
            WIDGET_NAME.test(widget.name) &&
            widget.domains.includes(host) &&
            !known.some((entry) => entry.sitekey === widget.sitekey),
        );
        const taken = [...known, ...remote].map((widget) => widgetNumber(widget.name));
        const name = orphan?.name ?? `deparked-${Math.max(0, ...taken) + 1}`;
        const secretName = `TURNSTILE_SECRET_${widgetNumber(name)}`;
        const created =
          orphan === undefined
            ? await ctx.cf.turnstile.create({ name, domains: [host] })
            : { sitekey: orphan.sitekey, secret: await ctx.cf.turnstile.getSecret(orphan.sitekey) };
        await ctx.cf.workers.putSecret(workerNames(ctx).admin, secretName, created.secret);
        await insertLedgerEntry(ctx.db, { resource: "secret", cfId: secretName, action: "created", now: ctx.now() });
        await insertTurnstileWidget(ctx.db, { sitekey: created.sitekey, name, secretName, now: ctx.now() });
        sitekey = created.sitekey;
        effects.push({ kind: "create", what: `a new bot check ${name} for ${host}` });
        effects.push({ kind: "create", what: `the secret key of ${name}, stored on the admin` });
      }

      if (findEntry(await activeLedger(ctx, host), "turnstile_hostname", sitekey) === undefined) {
        await insertLedgerEntry(ctx.db, {
          host,
          resource: "turnstile_hostname",
          cfId: sitekey,
          action: "created",
          now: ctx.now(),
        });
        if (!(await claimTurnstileSlot(ctx.db, sitekey))) throw new Error(`The bot check for ${host} is full.`);
      }
      await updateDomain(ctx.db, { host, patch: { turnstileWidgetId: sitekey }, now: ctx.now() });
      return { effects };
    },
  };
}

function analyticsStep(host: string): Step {
  const what = `visitor statistics for ${host}`;
  return {
    id: "analytics",
    title: "Count visits",
    async check(ctx) {
      const row = await getDomain(ctx.db, host);
      if (row !== undefined && row.analyticsSiteTag !== null) return done([{ kind: "reuse", what }]);
      const existing = (await ctx.cf.analytics.listSites()).some((site) => site.host === host);
      return needed([{ kind: existing ? "reuse" : "create", what }]);
    },
    async run(ctx) {
      if ((await getDomain(ctx.db, host)) === undefined) throw new Error(notInAccount(host));
      const existing = (await ctx.cf.analytics.listSites()).find((site) => site.host === host);
      const site = existing ?? (await ctx.cf.analytics.createSite(host));
      if (existing === undefined) {
        await insertLedgerEntry(ctx.db, {
          host,
          resource: "analytics_site",
          cfId: site.siteTag,
          action: "created",
          now: ctx.now(),
        });
      }
      await updateDomain(ctx.db, {
        host,
        patch: { analyticsSiteTag: site.siteTag, analyticsBeaconToken: site.siteToken ?? null },
        now: ctx.now(),
      });
      return { effects: [{ kind: existing === undefined ? "create" : "reuse", what }] };
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

type EmailCase =
  | { kind: "settled" }
  | { kind: "keep"; sender: string | null }
  | { kind: "use-existing" }
  | { kind: "enable" }
  | { kind: "replace"; mx: { name: string; content: string; priority: number | null }[] };

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
        })),
      };
    }
    const routing = await ctx.cf.email.getRouting(zoneId);
    return routing.enabled ? { kind: "use-existing" } : { kind: "enable" };
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
        await ctx.cf.email.enableRouting(zone, { replaceExistingMx: false });
        await insertLedgerEntry(ctx.db, { ...entry, action: "created", now: ctx.now() });
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
  return {
    id: "ready",
    title: "Get ready for the first page",
    async check(ctx) {
      if (isOn(await getDomain(ctx.db, host))) return done();
      return needed([{ kind: "change", what: `${host} is set up; its placeholder page is published next` }]);
    },
    async run(ctx) {
      const row = await setDomainStatus(ctx.db, { host, status: "placeholder", now: ctx.now() });
      if (row === undefined) throw new Error(notInAccount(host));
      return {
        effects: [{ kind: "change", what: `${host} is set up; publish placeholder next` }],
        next: "publish-placeholder",
      };
    },
  };
}

/**
 * The steps that attach a domain, in order. Building the plan does no I/O, so the admin rebuilds it on every
 * request from the host and the two confirmations. Turning a domain on again is the same plan.
 * The placeholder page is not published here: the last step's result says `next: "publish-placeholder"`.
 */
export function planAttachDomain(ctx: ProvisionContext, hostInput: string, options: AttachOptions = {}): Plan {
  const host = normalizeHost(hostInput);
  return {
    kind: "attach",
    host,
    ctx,
    steps: [
      registerStep(host, options),
      routesStep(host, options),
      rulesStep({
        id: "rewrite",
        title: "Show this domain's page to visitors",
        host,
        phase: "http_request_transform",
        rules: wantedRewriteRules(host),
        words: (rule) =>
          rule.description.endsWith("home page")
            ? `a rule that shows ${host}'s page at ${host}/`
            : `a rule that serves ${host}'s files (not /catalog/, /admin or /api/)`,
      }),
      rulesStep({
        id: "www-redirect",
        title: "Send www to the main address",
        host,
        phase: "http_request_dynamic_redirect",
        rules: wantedRedirectRules(host),
        words: () => `a rule that sends www.${host} to ${host}`,
      }),
      dnsStep(host),
      botCheckStep(host),
      analyticsStep(host),
      emailStep(host, options),
      readyStep(host),
    ],
  };
}
