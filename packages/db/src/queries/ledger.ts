import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { type LedgerAction, type LedgerEntry, type LedgerResource, ledger } from "../schema";

/** Records one Cloudflare resource Deparked created or changed. `host` is absent for hub-level resources. */
export async function insertLedgerEntry(
  db: Db,
  input: {
    host?: string;
    zoneId?: string;
    resource: LedgerResource;
    cfId?: string;
    action: LedgerAction;
    previousJson?: string;
    now: number;
  },
): Promise<LedgerEntry> {
  const rows = await db
    .insert(ledger)
    .values({
      host: input.host ?? null,
      zoneId: input.zoneId ?? null,
      resource: input.resource,
      cfId: input.cfId ?? null,
      action: input.action,
      previousJson: input.previousJson ?? null,
      createdAt: input.now,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error("ledger insert returned no row");
  return row;
}

/**
 * A host's ledger (`null`: hub level), newest first: the order in which Turn off undoes it. `activeOnly` leaves
 * out entries that were already undone.
 */
export function listLedger(db: Db, input: { host: string | null; activeOnly?: boolean }): Promise<LedgerEntry[]> {
  const ofHost = input.host === null ? isNull(ledger.host) : eq(ledger.host, input.host);
  return db
    .select()
    .from(ledger)
    .where(input.activeOnly ? and(ofHost, isNull(ledger.undoneAt)) : ofHost)
    .orderBy(desc(ledger.createdAt), desc(ledger.id));
}

/** Marks an entry as undone. False when it is unknown or was undone before. */
export async function markLedgerUndone(db: Db, input: { id: number; now: number }): Promise<boolean> {
  const rows = await db
    .update(ledger)
    .set({ undoneAt: input.now })
    .where(and(eq(ledger.id, input.id), isNull(ledger.undoneAt)))
    .returning({ id: ledger.id });
  return rows.length === 1;
}
