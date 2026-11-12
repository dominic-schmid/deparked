import type { CloudflareClient } from "@deparked/cf";
import { type Db, getDomain, type LedgerEntry, type LedgerResource, listLedger } from "@deparked/db";

/** Everything provisioning works with. It reads no environment: the caller builds the client and the database. */
export interface ProvisionContext {
  cf: CloudflareClient;
  db: Db;
  /** Epoch milliseconds, like every `@deparked/db` timestamp. */
  now: () => number;
  /** The two Workers' names. Default `DEFAULT_WORKERS`; a run against a real test account passes `deparked-test-*`. */
  workers?: WorkerNames;
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

/** What Deparked created or changed for the host and has not undone, newest first. */
export function activeLedger(ctx: ProvisionContext, host: string): Promise<LedgerEntry[]> {
  return listLedger(ctx.db, { host, activeOnly: true });
}

export function findEntry(
  entries: readonly LedgerEntry[],
  resource: LedgerResource,
  cfId: string,
): LedgerEntry | undefined {
  return entries.find((entry) => entry.resource === resource && entry.cfId === cfId);
}
