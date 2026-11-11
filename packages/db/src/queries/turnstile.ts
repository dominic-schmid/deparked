import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { TURNSTILE_HOSTNAMES_PER_WIDGET, type TurnstileWidget, turnstileWidgets } from "../schema";

/** Every Turnstile widget. A full read on purpose: the free plan allows 20. */
export function listTurnstileWidgets(db: Db): Promise<TurnstileWidget[]> {
  return db.select().from(turnstileWidgets).orderBy(asc(turnstileWidgets.createdAt));
}

/** Records a widget. False, changing nothing, when the sitekey is already known. */
export async function insertTurnstileWidget(
  db: Db,
  input: { sitekey: string; name: string; secretName: string; now: number },
): Promise<boolean> {
  const rows = await db
    .insert(turnstileWidgets)
    .values({ sitekey: input.sitekey, name: input.name, secretName: input.secretName, createdAt: input.now })
    .onConflictDoNothing({ target: turnstileWidgets.sitekey })
    .returning({ sitekey: turnstileWidgets.sitekey });
  return rows.length === 1;
}

/** The fullest widget that still has a free hostname slot, so widgets fill up one after another. */
export function findTurnstileWidgetWithFreeSlot(db: Db): Promise<TurnstileWidget | undefined> {
  return db
    .select()
    .from(turnstileWidgets)
    .where(lt(turnstileWidgets.hostnameCount, TURNSTILE_HOSTNAMES_PER_WIDGET))
    .orderBy(desc(turnstileWidgets.hostnameCount))
    .limit(1)
    .get();
}

/** Takes one hostname slot. False when the widget is full or unknown: the count never passes the limit. */
export async function claimTurnstileSlot(db: Db, sitekey: string): Promise<boolean> {
  const rows = await db
    .update(turnstileWidgets)
    .set({ hostnameCount: sql`${turnstileWidgets.hostnameCount} + 1` })
    .where(
      and(eq(turnstileWidgets.sitekey, sitekey), lt(turnstileWidgets.hostnameCount, TURNSTILE_HOSTNAMES_PER_WIDGET)),
    )
    .returning({ sitekey: turnstileWidgets.sitekey });
  return rows.length === 1;
}

/** Gives one hostname slot back (turn off, remove). False when the widget is unknown or already empty. */
export async function releaseTurnstileSlot(db: Db, sitekey: string): Promise<boolean> {
  const rows = await db
    .update(turnstileWidgets)
    .set({ hostnameCount: sql`${turnstileWidgets.hostnameCount} - 1` })
    .where(and(eq(turnstileWidgets.sitekey, sitekey), gt(turnstileWidgets.hostnameCount, 0)))
    .returning({ sitekey: turnstileWidgets.sitekey });
  return rows.length === 1;
}
