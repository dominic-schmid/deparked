import { and, count, desc, eq, inArray, max, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../client";
import { type EmailStatus, type Offer, type OfferSort, type OfferStatus, offers } from "../schema";
import { ulid } from "../ulid";

export type NewOffer = Pick<Offer, "host" | "amountMinor" | "currency" | "name" | "email"> &
  Partial<Pick<Offer, "country" | "message">>;

/** Stores the offer (status `new`, email `pending`) before any email is sent. The id is a new ULID. */
export async function insertOffer(db: Db, input: { offer: NewOffer; now: number }): Promise<Offer> {
  const rows = await db
    .insert(offers)
    .values({ ...input.offer, id: ulid(input.now), createdAt: input.now, updatedAt: input.now })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error("offer insert returned no row");
  return row;
}

export function getOffer(db: Db, id: string): Promise<Offer | undefined> {
  return db.select().from(offers).where(eq(offers.id, id)).get();
}

/**
 * Where a page of offers ended: the last row's sort value (`created_at` for `newest`, `amount_minor` for
 * `highest`) and id. Pass it back as `before`, with the same sort, to get the next page.
 */
export type OfferCursor = { key: number; id: string };

export type OfferPage = { offers: Offer[]; next: OfferCursor | null };

const FIRST_PAGE: OfferCursor = { key: Number.MAX_SAFE_INTEGER, id: "" };
const MAX_PAGE_SIZE = 200;
// D1 allows 100 bound parameters per statement.
const VALUES_PER_STATEMENT = 90;

/**
 * Offers newest or highest first, for one host or all, optionally one status. Keyset pagination on (sort column,
 * id): every page is an index range read, however deep. `highest` compares `amount_minor` as stored: amounts in
 * different currencies are not converted.
 */
export async function listOffers(
  db: Db,
  input: { host?: string; status?: OfferStatus; sort?: OfferSort; before?: OfferCursor; limit?: number } = {},
): Promise<OfferPage> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), MAX_PAGE_SIZE);
  const before = input.before ?? FIRST_PAGE;
  const column = input.sort === "highest" ? offers.amountMinor : offers.createdAt;
  const conditions: SQL[] = [sql`(${column}, ${offers.id}) < (${before.key}, ${before.id})`];
  if (input.host !== undefined) conditions.push(eq(offers.host, input.host));
  if (input.status !== undefined) conditions.push(eq(offers.status, input.status));
  const rows = await db
    .select()
    .from(offers)
    .where(and(...conditions))
    .orderBy(desc(column), desc(offers.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    offers: page,
    next:
      rows.length > limit && last !== undefined
        ? { key: input.sort === "highest" ? last.amountMinor : last.createdAt, id: last.id }
        : null,
  };
}

const earlier = alias(offers, "earlier");

/**
 * Each offer's place among its domain's offers, oldest first: 1 for the first offer a domain got. Ties on
 * `created_at` go by id, as in `listOffers`. Unknown ids are absent.
 */
export async function offerOrdinals(db: Db, ids: readonly string[]): Promise<Map<string, number>> {
  const ordinals = new Map<string, number>();
  for (let start = 0; start < ids.length; start += VALUES_PER_STATEMENT) {
    const before = db
      .select({ total: count() })
      .from(earlier)
      .where(
        and(
          eq(earlier.host, offers.host),
          sql`(${earlier.createdAt}, ${earlier.id}) <= (${offers.createdAt}, ${offers.id})`,
        ),
      );
    const rows = await db
      .select({ id: offers.id, ordinal: sql<number>`(${before})` })
      .from(offers)
      .where(inArray(offers.id, ids.slice(start, start + VALUES_PER_STATEMENT)));
    for (const row of rows) ordinals.set(row.id, row.ordinal);
  }
  return ordinals;
}

export async function setOfferStatus(
  db: Db,
  input: { id: string; status: OfferStatus; now: number },
): Promise<boolean> {
  const rows = await db
    .update(offers)
    .set({ status: input.status, updatedAt: input.now })
    .where(eq(offers.id, input.id))
    .returning({ id: offers.id });
  return rows.length === 1;
}

/** The outcome of sending the notification email: `sent` with the address, or `failed` with the error. */
export async function setOfferEmailStatus(
  db: Db,
  input: { id: string; emailStatus: EmailStatus; emailError?: string; notifiedTo?: string; now: number },
): Promise<boolean> {
  const rows = await db
    .update(offers)
    .set({
      emailStatus: input.emailStatus,
      emailError: input.emailError ?? null,
      notifiedTo: input.notifiedTo ?? null,
      updatedAt: input.now,
    })
    .where(eq(offers.id, input.id))
    .returning({ id: offers.id });
  return rows.length === 1;
}

/** Offers still marked `new`, for the inbox badge: one host or all. */
export async function countNewOffers(db: Db, host?: string): Promise<number> {
  const isNew = eq(offers.status, "new");
  const row = await db
    .select({ total: count() })
    .from(offers)
    .where(host === undefined ? isNew : and(eq(offers.host, host), isNew))
    .get();
  return row?.total ?? 0;
}

export type OfferStats = {
  host: string;
  total: number;
  newCount: number;
  /** Offers created at or after `since` (all of them without it). */
  recentCount: number;
  /** The largest `amount_minor` and that offer's currency. Amounts in different currencies are not converted. */
  bestAmountMinor: number;
  bestCurrency: string;
};

/**
 * Offer count, new count, count since `since` and best offer for each given host that has offers; hosts without
 * offers are absent. Reads only those hosts' index ranges.
 */
export async function offerStatsForHosts(db: Db, hosts: readonly string[], since = 0): Promise<OfferStats[]> {
  const stats: OfferStats[] = [];
  for (let start = 0; start < hosts.length; start += VALUES_PER_STATEMENT) {
    const rows = await db
      .select({
        host: offers.host,
        total: count(),
        newCount: sql<number>`sum(${offers.status} = 'new')`,
        recentCount: sql<number>`sum(${offers.createdAt} >= ${since})`,
        bestAmountMinor: max(offers.amountMinor),
        // SQLite takes a bare column from the row that holds the max().
        bestCurrency: offers.currency,
      })
      .from(offers)
      .where(inArray(offers.host, hosts.slice(start, start + VALUES_PER_STATEMENT)))
      .groupBy(offers.host);
    for (const row of rows) stats.push({ ...row, bestAmountMinor: row.bestAmountMinor ?? 0 });
  }
  return stats;
}
