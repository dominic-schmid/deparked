import { CloudflareApiError } from "@deparked/cf";
import {
  getDomain,
  type LedgerEntry,
  type LedgerResource,
  listDomains,
  markLedgerUndone,
  releaseTurnstileSlot,
  setDomainStatus,
  updateDomain,
} from "@deparked/db";
import { z } from "zod";
import { pickSenderHost } from "./attach";
import { activeLedger, normalizeHost, type ProvisionContext } from "./context";
import type { Effect, Plan, Step, StepCheck } from "./steps";

const previousRoute = z.object({ pattern: z.string(), script: z.string().nullable() });
const previousMail = z.object({
  mx: z.array(z.object({ name: z.string(), content: z.string(), priority: z.number().nullable() })),
});

function previous<T>(entry: LedgerEntry, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(entry.previousJson ?? "null"));
}

/** Something that is already gone counts as undone. */
async function unlessGone(call: Promise<unknown>): Promise<"gone" | "ok"> {
  try {
    await call;
    return "ok";
  } catch (error) {
    if (error instanceof CloudflareApiError && error.status === 404) return "gone";
    throw error;
  }
}

function notManaged(host: string): string {
  return `${host} is not a domain Deparked manages.`;
}

/** What undoing one ledger entry does, in plain words. Built from the ledger alone: no request. */
function undoEffect(host: string, entry: LedgerEntry): Effect {
  switch (entry.resource) {
    case "route": {
      if (entry.action === "created") return { kind: "remove", what: `a route that sends ${host} to Deparked` };
      const route = previous(entry, previousRoute);
      return { kind: "restore", what: `${route.pattern} goes back to ${route.script ?? "no Worker"}` };
    }
    case "rule":
      return { kind: "remove", what: `a rule Deparked added for ${host}` };
    case "dns_record":
      return { kind: "remove", what: `an address record Deparked added for ${host}` };
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

interface UndoStepInput {
  id: string;
  title: string;
  host: string;
  resource: LedgerResource;
  /** True when the `domains` row still holds what this step clears. */
  rowPending?: (ctx: ProvisionContext) => Promise<boolean>;
  /** Undoes the entries (newest first) in Cloudflare, marking each as undone once it is. */
  undo: (ctx: ProvisionContext, entries: LedgerEntry[]) => Promise<void>;
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
      const effects = (await entries(ctx)).map((entry) => undoEffect(host, entry));
      const pending = effects.length > 0 || (await input.rowPending?.(ctx)) === true;
      return { status: pending ? "needed" : "done", effects };
    },
    async run(ctx) {
      const list = await entries(ctx);
      const effects = list.map((entry) => undoEffect(host, entry));
      await input.undo(ctx, list);
      await input.clearRow?.(ctx);
      return { effects };
    },
  };
}

const undone = (ctx: ProvisionContext, entry: LedgerEntry) =>
  markLedgerUndone(ctx.db, { id: entry.id, now: ctx.now() });

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
      if (entries.length === 0) return;
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
        if ((await ctx.cf.email.getRouting(zoneId)).enabled) await ctx.cf.email.disableRouting(zoneId);
        if (entry.action === "changed") {
          const present = await ctx.cf.zones.listDnsRecords(zoneId, { type: "MX", name: host });
          for (const record of previous(entry, previousMail).mx) {
            if (present.some((existing) => existing.name === record.name && existing.content === record.content)) {
              continue;
            }
            await ctx.cf.zones.createDnsRecord(zoneId, {
              type: "MX",
              name: record.name,
              content: record.content,
              ...(record.priority === null ? {} : { priority: record.priority }),
            });
          }
        }
        await undone(ctx, entry);
      }
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
      for (const entry of entries) {
        await unlessGone(ctx.cf.analytics.deleteSite(entry.cfId ?? ""));
        await undone(ctx, entry);
      }
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

/** The widget and its secret stay: they are shared, and the next domain takes the free place. */
function stopBotCheckStep(host: string): Step {
  return undoStep({
    id: "stop-bot-check",
    title: "Free the place in the bot check",
    host,
    resource: "turnstile_hostname",
    async rowPending(ctx) {
      return (await getDomain(ctx.db, host))?.turnstileWidgetId != null;
    },
    async undo(ctx, entries) {
      if (entries.length === 0) return;
      const widgets = await ctx.cf.turnstile.list();
      for (const entry of entries) {
        const widget = widgets.find((candidate) => candidate.sitekey === entry.cfId);
        if (widget?.domains.includes(host) === true) {
          await ctx.cf.turnstile.updateHostnames(
            widget,
            widget.domains.filter((domain) => domain !== host),
          );
        }
        // Marked first: a failure in between then wastes a place instead of freeing one twice.
        if (await undone(ctx, entry)) await releaseTurnstileSlot(ctx.db, entry.cfId ?? "");
      }
    },
    async clearRow(ctx) {
      await updateDomain(ctx.db, { host, patch: { turnstileWidgetId: null }, now: ctx.now() });
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
        await undone(ctx, entry);
      }
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
      if (entries.length === 0) return;
      const zoneId = entries[0]?.zoneId ?? "";
      const rulesets = [
        await ctx.cf.rulesets.getEntrypoint(zoneId, "http_request_dynamic_redirect"),
        await ctx.cf.rulesets.getEntrypoint(zoneId, "http_request_transform"),
      ];
      for (const entry of entries) {
        const ruleset = rulesets.find((candidate) => candidate?.rules.some((rule) => rule.id === entry.cfId));
        if (ruleset != null) await unlessGone(ctx.cf.rulesets.deleteRule(zoneId, ruleset.id, entry.cfId ?? ""));
        await undone(ctx, entry);
      }
    },
  });
}

function stopRoutesStep(host: string): Step {
  return undoStep({
    id: "stop-routes",
    title: "Give the address back",
    host,
    resource: "route",
    async undo(ctx, entries) {
      for (const entry of entries) {
        const zoneId = entry.zoneId ?? "";
        const routeId = entry.cfId ?? "";
        if (entry.action === "created") {
          await unlessGone(ctx.cf.zones.deleteRoute(zoneId, routeId));
        } else {
          const route = previous(entry, previousRoute);
          const original = { pattern: route.pattern, ...(route.script === null ? {} : { script: route.script }) };
          const result = await unlessGone(ctx.cf.zones.updateRoute(zoneId, routeId, original));
          if (result === "gone" && route.script !== null) {
            await ctx.cf.zones.createRoute(zoneId, { pattern: route.pattern, script: route.script });
          }
        }
        await undone(ctx, entry);
      }
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

function turnOffSteps(host: string): Step[] {
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
  const entries = (await activeLedger(ctx, host)).toSorted(
    (a, b) => order.indexOf(a.resource) - order.indexOf(b.resource),
  );
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
