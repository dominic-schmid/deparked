import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { rateLimits } from "../schema";

/**
 * The provisioning lock is one `rate_limits` row: `window_start` is when it was taken or last renewed, `count`
 * the holder's token. Its key cannot collide with a rate limit's (those are `<kind>:<hash>`), and the daily prune
 * of old windows only ever finds a lock that expired long ago.
 */
const PROVISION_LOCK_KEY = "lock:provision";

/**
 * Takes or renews the provisioning lock, in one statement: true when it was free, its time ran out (a crashed
 * step cannot block forever) or `holder` already holds it. False while another holder has it.
 */
export async function acquireProvisionLock(
  db: Db,
  input: { holder: number; ttlMs: number; now: number },
): Promise<boolean> {
  const rows = await db
    .insert(rateLimits)
    .values({ key: PROVISION_LOCK_KEY, windowStart: input.now, count: input.holder })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { windowStart: sql`excluded.window_start`, count: sql`excluded.count` },
      setWhere: sql`${rateLimits.windowStart} + ${input.ttlMs} <= ${input.now} or ${rateLimits.count} = ${input.holder}`,
    })
    .returning({ key: rateLimits.key });
  return rows.length === 1;
}

/** Releases the lock if `holder` holds it. False when it does not (expired and taken over, or released). */
export async function releaseProvisionLock(db: Db, holder: number): Promise<boolean> {
  const rows = await db
    .delete(rateLimits)
    .where(and(eq(rateLimits.key, PROVISION_LOCK_KEY), eq(rateLimits.count, holder)))
    .returning({ key: rateLimits.key });
  return rows.length === 1;
}
