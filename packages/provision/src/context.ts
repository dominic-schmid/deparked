import { CloudflareApiError, type CloudflareClient } from "@deparked/cf";
import {
  type Db,
  getDomain,
  insertLedgerEntry,
  type LedgerEntry,
  type LedgerResource,
  listLedger,
  markLedgerUndone,
  updateLedgerEntry,
} from "@deparked/db";

/** Everything provisioning works with. It reads no environment: the caller builds the client and the database. */
export interface ProvisionContext {
  cf: CloudflareClient;
  db: Db;
  /** Epoch milliseconds, like every `@deparked/db` timestamp. */
  now: () => number;
  /** The two Workers' names. Default `DEFAULT_WORKERS`; a run against a real test account passes `deparked-test-*`. */
  workers?: WorkerNames;
  /**
   * Publishes the placeholder page of a host through the caller's publish pipeline, and records its files in
   * `site_files` (that row is how a repeat knows the page is there). Called while the domain's status is still
   * `off`, before any route or rule points visitors at Deparked. Attaching is blocked without it.
   */
  publishPlaceholder?: (host: string) => Promise<void>;
}

export interface WorkerNames {
  sites: string;
  admin: string;
}

export const DEFAULT_WORKERS: WorkerNames = { sites: "deparked-sites", admin: "deparked-admin" };

export function workerNames(ctx: ProvisionContext): WorkerNames {
  return ctx.workers ?? DEFAULT_WORKERS;
}

export class InvalidHostError extends Error {
  constructor(input: string) {
    super(`${JSON.stringify(input)} is not a domain name`);
    this.name = "InvalidHostError";
  }
}

const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * Lowercases a hostname and drops a trailing dot. Throws `InvalidHostError` for anything else: the host ends up
 * inside rule expressions and route patterns, so nothing but letters, digits, hyphens and dots may pass.
 */
export function normalizeHost(input: string): string {
  const host = input.trim().toLowerCase().replace(/\.$/, "");
  if (!HOST.test(host)) throw new InvalidHostError(input);
  return host;
}

export interface ZoneRef {
  id: string;
  name: string;
}

/**
 * The zone of a host: from its `domains` row once the domain is known (no request), else by name from
 * Cloudflare (1 request). Null when the account has no such zone.
 */
export async function findZone(ctx: ProvisionContext, host: string): Promise<ZoneRef | null> {
  const row = await getDomain(ctx.db, host);
  if (row !== undefined) return { id: row.zoneId, name: host };
  const [zone] = await ctx.cf.zones.list({ name: host });
  return zone === undefined ? null : { id: zone.id, name: zone.name };
}

export function notInAccount(host: string): string {
  return `${host} is not in this Cloudflare account. Add it to Cloudflare first, then come back.`;
}

/** What Deparked created or changed for the host (`null`: hub level) and has not undone, newest first. */
export function activeLedger(ctx: ProvisionContext, host: string | null): Promise<LedgerEntry[]> {
  return listLedger(ctx.db, { host, activeOnly: true });
}

export function findEntry(
  entries: readonly LedgerEntry[],
  resource: LedgerResource,
  cfId: string,
): LedgerEntry | undefined {
  return entries.find((entry) => entry.resource === resource && entry.cfId === cfId);
}

/** The Cloudflare ids the ledger names for a kind of resource. Nothing else is Deparked's. */
export function ownedIds(entries: readonly LedgerEntry[], resource: LedgerResource): Set<string> {
  return new Set(entries.filter((entry) => entry.resource === resource).flatMap((entry) => entry.cfId ?? []));
}

/**
 * What a `created` entry was written for (a route pattern, a rule description, a record name). The ledger has
 * no column for it, so it lives in `previous_json` as `{ "intent": key }`. Null for other entries.
 */
export function intentKey(entry: LedgerEntry): string | null {
  if (entry.action !== "created" || entry.previousJson === null) return null;
  const parsed: unknown = JSON.parse(entry.previousJson);
  const key = typeof parsed === "object" && parsed !== null ? (parsed as { intent?: unknown }).intent : undefined;
  return typeof key === "string" ? key : null;
}

/** An entry announced before its create call whose Cloudflare id was never filled in. */
function pendingIntent(entries: readonly LedgerEntry[], resource: LedgerResource, key: string) {
  return entries.find((entry) => entry.resource === resource && entry.cfId === null && intentKey(entry) === key);
}

/** What `createOnce` would do, without doing it. */
export function wouldCreate(
  entries: readonly LedgerEntry[],
  resource: LedgerResource,
  key: string,
  lookAlikes: readonly string[],
): boolean {
  const pending = pendingIntent(entries, resource, key) !== undefined;
  return pending ? lookAlikes.length <= 1 : lookAlikes.length === 0;
}

/**
 * Creates one resource so that a failure at any point leaves neither an orphan nor a duplicate.
 *
 * `lookAlikes` are the ids of resources that exist right now, do what the wanted one does and are not in the
 * ledger. Without an announcement they are the owner's: they are reused and nothing is written. Otherwise the
 * create is announced in the ledger first (an entry without an id) and the id is filled in after the call.
 * An announcement without an id found on a retry means an earlier call may have worked without the answer
 * arriving: since it was only written while no look-alike existed, exactly one look-alike now is that
 * resource and gets the entry; none means the call never worked and it is made again. A create Cloudflare
 * answers with a 4xx withdraws the announcement before the error goes on.
 */
export async function createOnce(
  ctx: ProvisionContext,
  input: {
    entries: readonly LedgerEntry[];
    host?: string;
    zoneId?: string;
    resource: LedgerResource;
    key: string;
    lookAlikes: readonly string[];
    create: () => Promise<string>;
  },
): Promise<{ outcome: "created" | "reused"; cfId: string | undefined }> {
  const pending = pendingIntent(input.entries, input.resource, input.key);
  if (pending === undefined && input.lookAlikes.length > 0) return { outcome: "reused", cfId: input.lookAlikes[0] };
  if (pending !== undefined && input.lookAlikes.length > 1) {
    // Several candidates: none can be proven to be Deparked's, so none is claimed.
    await markLedgerUndone(ctx.db, { id: pending.id, now: ctx.now() });
    return { outcome: "reused", cfId: input.lookAlikes[0] };
  }
  const entry =
    pending ??
    (await insertLedgerEntry(ctx.db, {
      ...(input.host === undefined ? {} : { host: input.host }),
      ...(input.zoneId === undefined ? {} : { zoneId: input.zoneId }),
      resource: input.resource,
      action: "created",
      previousJson: JSON.stringify({ intent: input.key }),
      now: ctx.now(),
    }));
  let cfId = input.lookAlikes[0];
  try {
    cfId ??= await input.create();
  } catch (error) {
    // A 4xx answer means Cloudflare created nothing: an announcement left open would let a later look-alike
    // of the owner's be adopted. Only an unknown outcome (no answer, 5xx) keeps it.
    if (error instanceof CloudflareApiError && error.status >= 400 && error.status < 500) {
      await markLedgerUndone(ctx.db, { id: entry.id, now: ctx.now() });
    }
    throw error;
  }
  await updateLedgerEntry(ctx.db, { id: entry.id, cfId });
  return { outcome: "created", cfId };
}

/** Withdraws an announcement that no longer applies (the owner created something else in its place). */
export async function withdrawIntent(
  ctx: ProvisionContext,
  entries: readonly LedgerEntry[],
  resource: LedgerResource,
  key: string,
): Promise<void> {
  const pending = pendingIntent(entries, resource, key);
  if (pending !== undefined) await markLedgerUndone(ctx.db, { id: pending.id, now: ctx.now() });
}
