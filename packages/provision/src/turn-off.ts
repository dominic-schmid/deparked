import { CloudflareApiError, type WorkerRoute } from "@deparked/cf";
import {
  getDomain,
  type LedgerEntry,
  type LedgerResource,
  listDomains,
  markLedgerUndone,
  setDomainStatus,
  syncTurnstileHostnameCount,
  updateDomain,
  updateLedgerEntry,
} from "@deparked/db";
import { z } from "zod";
import { pickSenderHost } from "./attach";
import { activeLedger, intentKey, normalizeHost, type ProvisionContext, workerNames } from "./context";
import type { Effect, Plan, Step, StepCheck } from "./steps";
import { wantedRoutes } from "./wanted";

const previousRoute = z.object({ pattern: z.string(), script: z.string().nullable() });
const previousMail = z.object({
  mx: z.array(
    z.object({
      name: z.string(),
      content: z.string(),
      priority: z.number().nullable(),
      ttl: z.number().nullable().default(null),
    }),
  ),
});

function previous<T>(entry: LedgerEntry, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(entry.previousJson ?? "null"));
}

const refused = (error: unknown, ...statuses: number[]) =>
  error instanceof CloudflareApiError && statuses.includes(error.status);

/** `gone` when Cloudflare answers 404: the zone or the feature no longer exists. Turn off must still finish. */
async function orIfGone<T>(call: Promise<T>, gone: T): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (!refused(error, 404)) throw error;
    return gone;
  }
}

/** Something that is already gone counts as undone. */
async function unlessGone(call: Promise<unknown>): Promise<void> {
  await orIfGone(call, undefined);
}

const leftAsIs = (what: string): Effect => ({ kind: "reuse", what });

function notManaged(host: string): string {
  return `${host} is not a domain Deparked manages.`;
}

/** What undoing one ledger entry is meant to do, in plain words. Built from the ledger alone: no request. */
function undoEffect(host: string, entry: LedgerEntry): Effect {
  const key = intentKey(entry);
  switch (entry.resource) {
    case "route": {
      if (entry.action === "created") return { kind: "remove", what: `the route ${key ?? host} to Deparked` };
      const route = previous(entry, previousRoute);
      return { kind: "restore", what: `${route.pattern} goes back to ${route.script ?? "no Worker"}` };
    }
    case "rule":
      return { kind: "remove", what: `the rule "${key ?? `Deparked ${host}`}"` };
    case "dns_record":
      return { kind: "remove", what: `the address record Deparked added for ${key ?? host}` };
    case "turnstile_hostname":
      return { kind: "remove", what: `${host}'s place in the bot check` };
    case "analytics_site":
      return { kind: "remove", what: `visitor statistics for ${host} (the collected numbers are deleted)` };
    case "email_routing": {
      if (entry.action === "created") return { kind: "remove", what: `Cloudflare's email service on ${host}` };
      const targets = previous(entry, previousMail)
        .mx.map((record) => record.content)
        .join(", ");
      return {
        kind: "restore",
        what: `Cloudflare's email service on ${host} is turned off and your mail records come back (${targets})`,
      };
    }
    default:
      return { kind: "remove", what: `${entry.resource} ${entry.cfId ?? ""}`.trim() };
  }
}

/** An entry with a Cloudflare id. One without was announced, but whether the create worked is unknown. */
const exists = (entry: LedgerEntry) => entry.cfId !== null;

/** What the owner has to look at by hand: Turn off cannot remove what it has no id for. */
function unknownEffect(host: string, entry: LedgerEntry): Effect {
  return leftAsIs(
    `${undoEffect(host, entry).what} may still exist in Cloudflare: Deparked never learned whether creating it worked. Look for it in Cloudflare and remove it there if it is there.`,
  );
}

function reportEffects(host: string, list: readonly LedgerEntry[]): Effect[] {
  return list.map((entry) => (exists(entry) ? undoEffect(host, entry) : unknownEffect(host, entry)));
}

interface UndoStepInput {
  id: string;
  title: string;
  host: string;
  resource: LedgerResource;
  /** True when the `domains` row still holds what this step clears. */
  rowPending?: (ctx: ProvisionContext) => Promise<boolean>;
  /**
   * Undoes the entries (newest first) in Cloudflare. Whatever is already gone counts as undone. Returns what
   * it left as it is and why, for the owner to read.
   */
  undo: (ctx: ProvisionContext, entries: LedgerEntry[]) => Promise<Effect[]>;
  /** Clears the step's fields on the `domains` row. */
  clearRow?: (ctx: ProvisionContext) => Promise<void>;
}

function undoStep(input: UndoStepInput): Step {
  const { host } = input;
  const entries = async (ctx: ProvisionContext) =>
    (await activeLedger(ctx, host)).filter((entry) => entry.resource === input.resource);
  return {
    id: input.id,
    title: input.title,
    async check(ctx): Promise<StepCheck> {
      if ((await getDomain(ctx.db, host)) === undefined) return { status: "blocked", reason: notManaged(host) };
      const list = await entries(ctx);
      const pending = list.length > 0 || (await input.rowPending?.(ctx)) === true;
      return {
        status: pending ? "needed" : "done",
        effects: reportEffects(host, list),
      };
    },
    async run(ctx) {
      const list = await entries(ctx);
      const notes = await input.undo(ctx, list.filter(exists));
      for (const entry of list) await markLedgerUndone(ctx.db, { id: entry.id, now: ctx.now() });
      await input.clearRow?.(ctx);
      return { effects: [...reportEffects(host, list), ...notes] };
    },
  };
}

function stopEmailStep(host: string): Step {
  return undoStep({
    id: "stop-email",
    title: "Stop sending offer emails from this domain",
    host,
    resource: "email_routing",
    async rowPending(ctx) {
      const row = await getDomain(ctx.db, host);
      return row !== undefined && (row.emailRoutingState !== "none" || row.senderHost !== null);
    },
    async undo(ctx, entries) {
      const notes: Effect[] = [];
      if (entries.length === 0) return notes;
      // Domains that kept their own mail and send through this one move to another sender first.
      const domains = await listDomains(ctx.db);
      const replacement = pickSenderHost(domains, host, null);
      for (const domain of domains) {
        if (domain.host === host || domain.senderHost !== host) continue;
        await updateDomain(ctx.db, { host: domain.host, patch: { senderHost: replacement }, now: ctx.now() });
      }
      for (const entry of entries) {
        const zoneId = entry.zoneId ?? "";
        // An attach that failed right after writing the entry down never turned the service on.
        const routing = await orIfGone(ctx.cf.email.getRouting(zoneId), null);
        if (routing?.enabled === true) await unlessGone(ctx.cf.email.disableRouting(zoneId));
        if (entry.action !== "changed") continue;
        const present = await orIfGone(ctx.cf.zones.listDnsRecords(zoneId, { type: "MX", name: host }), []);
        for (const record of previous(entry, previousMail).mx) {
          if (present.some((existing) => existing.name === record.name && existing.content === record.content)) {
            continue;
          }
          if (record.priority === null) {
            notes.push(
              leftAsIs(`not put back: the mail record ${record.content} had no priority, add it by hand in Cloudflare`),
            );
            continue;
          }
          try {
            await ctx.cf.zones.createDnsRecord(zoneId, {
              type: "MX",
              name: record.name,
              content: record.content,
              priority: record.priority,
              ...(record.ttl === null ? {} : { ttl: record.ttl }),
            });
          } catch (error) {
            // A record Cloudflare refuses must not keep the rest of Turn off from happening.
            if (!refused(error, 400, 404, 409)) throw error;
            notes.push(leftAsIs(`not put back: Cloudflare refused the mail record ${record.content}, add it by hand`));
          }
        }
      }
      return notes;
    },
    async clearRow(ctx) {
      await updateDomain(ctx.db, { host, patch: { emailRoutingState: "none", senderHost: null }, now: ctx.now() });
    },
  });
}

function stopAnalyticsStep(host: string): Step {
  return undoStep({
    id: "stop-analytics",
    title: "Stop counting visits",
    host,
    resource: "analytics_site",
    async rowPending(ctx) {
      return (await getDomain(ctx.db, host))?.analyticsSiteTag != null;
    },
    async undo(ctx, entries) {
      for (const entry of entries) await unlessGone(ctx.cf.analytics.deleteSite(entry.cfId ?? ""));
      return [];
    },
    async clearRow(ctx) {
      await updateDomain(ctx.db, {
        host,
        patch: { analyticsSiteTag: null, analyticsBeaconToken: null },
        now: ctx.now(),
      });
    },
  });
}

/**
 * Frees the place the domain holds, which is what `domains.turnstile_widget_id` says and nothing else. The
 * widget's hostname list is read right before it is written. The widget and its secret stay: they are shared,
 * and the next domain takes the free place.
 */
function stopBotCheckStep(host: string): Step {
  return undoStep({
    id: "stop-bot-check",
    title: "Free the place in the bot check",
    host,
    resource: "turnstile_hostname",
    async rowPending(ctx) {
      return (await getDomain(ctx.db, host))?.turnstileWidgetId != null;
    },
    async undo(ctx) {
      const held = (await getDomain(ctx.db, host))?.turnstileWidgetId ?? null;
      if (held === null) return [];
      const widget = (await ctx.cf.turnstile.list()).find((candidate) => candidate.sitekey === held);
      if (widget?.domains.includes(host) === true) {
        await unlessGone(
          ctx.cf.turnstile.updateHostnames(
            widget,
            widget.domains.filter((domain) => domain !== host),
          ),
        );
      }
      await updateDomain(ctx.db, { host, patch: { turnstileWidgetId: null }, now: ctx.now() });
      await syncTurnstileHostnameCount(ctx.db, held);
      return [];
    },
  });
}

function stopDnsStep(host: string): Step {
  return undoStep({
    id: "stop-dns",
    title: "Remove the address records Deparked added",
    host,
    resource: "dns_record",
    async undo(ctx, entries) {
      for (const entry of entries) {
        await unlessGone(ctx.cf.zones.deleteDnsRecord(entry.zoneId ?? "", entry.cfId ?? ""));
      }
      return [];
    },
  });
}

function stopRulesStep(host: string): Step {
  return undoStep({
    id: "stop-rules",
    title: "Remove Deparked's rules",
    host,
    resource: "rule",
    async undo(ctx, entries) {
      if (entries.length === 0) return [];
      const zoneId = entries[0]?.zoneId ?? "";
      const rulesets = [
        await ctx.cf.rulesets.getEntrypoint(zoneId, "http_request_dynamic_redirect"),
        await ctx.cf.rulesets.getEntrypoint(zoneId, "http_request_transform"),
      ];
      for (const entry of entries) {
        const ruleset = rulesets.find((candidate) => candidate?.rules.some((rule) => rule.id === entry.cfId));
        if (ruleset != null) await unlessGone(ctx.cf.rulesets.deleteRule(zoneId, ruleset.id, entry.cfId ?? ""));
        // One at a time: a failure further on must not make a deleted rule look like it is still there.
        await markLedgerUndone(ctx.db, { id: entry.id, now: ctx.now() });
      }
      return [];
    },
  });
}

/**
 * A route is only touched while it is still what Deparked made of it: the same id and pattern, pointing at the
 * Deparked Worker that pattern goes to. One the owner changed since stays as it is, one that is gone is not brought back, and a
 * restore Cloudflare refuses is reported instead of retried forever.
 */
function stopRoutesStep(host: string): Step {
  return undoStep({
    id: "stop-routes",
    title: "Give the address back",
    host,
    resource: "route",
    async undo(ctx, entries) {
      const notes: Effect[] = [];
      if (entries.length === 0) return notes;
      const wanted = wantedRoutes(host, workerNames(ctx));
      const routes = new Map<string, WorkerRoute[]>();
      for (const entry of entries) {
        const zoneId = entry.zoneId ?? "";
        if (!routes.has(zoneId)) routes.set(zoneId, await orIfGone(ctx.cf.zones.listRoutes(zoneId), []));
        const route = routes.get(zoneId)?.find((candidate) => candidate.id === entry.cfId);
        const original = entry.action === "changed" ? previous(entry, previousRoute) : undefined;
        const pattern = original?.pattern ?? intentKey(entry) ?? route?.pattern;
        // The one Worker Deparked pointed this pattern at; the other Deparked Worker is a change too.
        const script = wanted.find((candidate) => candidate.pattern === pattern)?.script;
        const note = async (text: string, words: string) => {
          notes.push(leftAsIs(`left as is: ${pattern} ${words}`));
          if (original !== undefined) {
            await updateLedgerEntry(ctx.db, {
              id: entry.id,
              previousJson: JSON.stringify({ ...original, note: text }),
            });
          }
        };
        if (route === undefined) {
          if (original !== undefined) await note("left as is: gone", "no longer exists and was not brought back");
        } else if (route.pattern !== pattern || route.script !== script) {
          await note("left as is: changed after Deparked", "was changed after Deparked set it");
        } else if (original === undefined) {
          await unlessGone(ctx.cf.zones.deleteRoute(zoneId, route.id));
        } else {
          try {
            await ctx.cf.zones.updateRoute(zoneId, route.id, {
              pattern: original.pattern,
              ...(original.script === null ? {} : { script: original.script }),
            });
          } catch (error) {
            if (!refused(error, 400, 404, 409)) throw error;
            await note("left as is: Cloudflare refused the restore", "could not be given back (Cloudflare refused)");
          }
        }
        await markLedgerUndone(ctx.db, { id: entry.id, now: ctx.now() });
      }
      return notes;
    },
  });
}

function markStep(host: string, status: "off" | "removed"): Step {
  const reached = (current: string | undefined) => current === status || (status === "off" && current === "removed");
  const what = status === "off" ? `${host} is off; its design and offers stay` : `${host} leaves Deparked's list`;
  return {
    id: status === "off" ? "mark-off" : "mark-removed",
    title: status === "off" ? "Mark the domain as off" : "Take the domain off the list",
    async check(ctx) {
      const row = await getDomain(ctx.db, host);
      if (row === undefined) return { status: "blocked", reason: notManaged(host) };
      return reached(row.status)
        ? { status: "done", effects: [] }
        : { status: "needed", effects: [{ kind: "change", what }] };
    },
    async run(ctx) {
      await setDomainStatus(ctx.db, { host, status, now: ctx.now() });
      return { effects: [{ kind: "change", what }] };
    },
  };
}

export function turnOffSteps(host: string): Step[] {
  return [
    stopEmailStep(host),
    stopAnalyticsStep(host),
    stopBotCheckStep(host),
    stopDnsStep(host),
    stopRulesStep(host),
    stopRoutesStep(host),
    markStep(host, "off"),
  ];
}

/**
 * Undoes the domain's ledger, newest first within each kind and the kinds in the reverse of the attach order:
 * what Deparked created is deleted, what it changed gets its previous value back. The domain then serves what
 * it served before. Its design, wording and offers stay, and turning it on again is `planAttachDomain`.
 */
export function planTurnOff(ctx: ProvisionContext, hostInput: string): Plan {
  const host = normalizeHost(hostInput);
  return { kind: "turn-off", host, ctx, steps: turnOffSteps(host) };
}

/** Turn off, then take the domain off the list. The rows stay in the database until Uninstall. */
export function planRemoveDomain(ctx: ProvisionContext, hostInput: string): Plan {
  const host = normalizeHost(hostInput);
  return { kind: "remove", host, ctx, steps: [...turnOffSteps(host), markStep(host, "removed")] };
}

export interface RemovalDescription {
  host: string;
  /** What Turn off or Remove deletes or puts back in Cloudflare, in the order it happens. */
  effects: Effect[];
  /** What stays in the hub either way. */
  keeps: string[];
}

/** The list the owner confirms before a domain is turned off or removed. Reads the ledger only: no request. */
export async function describeRemoval(ctx: ProvisionContext, hostInput: string): Promise<RemovalDescription> {
  const host = normalizeHost(hostInput);
  const order = turnOffOrder();
  const entries = (await activeLedger(ctx, host))
    .filter(exists)
    .toSorted((a, b) => order.indexOf(a.resource) - order.indexOf(b.resource));
  return {
    host,
    effects: entries.map((entry) => undoEffect(host, entry)),
    keeps: [
      `the design and wording of ${host}`,
      `the offers ${host} received`,
      "the bot check itself and its secret key, which other domains share",
    ],
  };
}

function turnOffOrder(): LedgerResource[] {
  return ["email_routing", "analytics_site", "turnstile_hostname", "dns_record", "rule", "route"];
}
