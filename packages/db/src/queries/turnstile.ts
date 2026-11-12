import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { domains, TURNSTILE_HOSTNAMES_PER_WIDGET, type TurnstileWidget, turnstileWidgets } from "../schema";

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

/** Sets `hostname_count` to the number of domains that hold a slot of the widget. Safe to repeat. */
export async function syncTurnstileHostnameCount(db: Db, sitekey: string): Promise<void> {
  await db
    .update(turnstileWidgets)
    .set({
      hostnameCount: sql`(select count(*) from ${domains} where ${domains.turnstileWidgetId} = ${sitekey})`,
    })
    .where(eq(turnstileWidgets.sitekey, sitekey));
}

/**
 * Gives a domain that holds no slot one hostname slot of the widget, in a single statement: the slot and
 * `domains.turnstile_widget_id` can never disagree, and a repeat changes nothing. The number of domains that
 * hold the widget is what counts; `hostname_count` is brought in line afterwards. False when the widget is
 * full or the domain is unknown or already holds a slot.
 */
export async function assignTurnstileWidget(
  db: Db,
  input: { host: string; sitekey: string; now: number },
): Promise<boolean> {
  const rows = await db
    .update(domains)
    .set({ turnstileWidgetId: input.sitekey, updatedAt: input.now })
    .where(
      and(
        eq(domains.host, input.host),
        isNull(domains.turnstileWidgetId),
        sql`(select count(*) from ${domains} as holders where holders.turnstile_widget_id = ${input.sitekey}) < ${TURNSTILE_HOSTNAMES_PER_WIDGET}`,
      ),
    )
    .returning({ host: domains.host });
  await syncTurnstileHostnameCount(db, input.sitekey);
  return rows.length === 1;
}
