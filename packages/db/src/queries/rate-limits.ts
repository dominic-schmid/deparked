import { eq, lt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { rateLimits } from "../schema";

export type RateLimitHit = { count: number; windowStart: number };

/**
 * Counts one hit for `key` (e.g. `login:<ip-hash>`, never a raw IP) in a fixed window, in one atomic statement,
 * and returns the count including this hit. A window older than `windowMs` starts again at 1.
 */
export async function hitRateLimit(
  db: Db,
  input: { key: string; windowMs: number; now: number },
): Promise<RateLimitHit> {
  const expired = sql`${rateLimits.windowStart} + ${input.windowMs} <= ${input.now}`;
  const rows = await db
    .insert(rateLimits)
    .values({ key: input.key, windowStart: input.now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then ${input.now} else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });
  const row = rows[0];
  if (row === undefined) throw new Error("rate limit upsert returned no row");
  return row;
}

/** Forgets a key, e.g. after a successful login. */
export async function clearRateLimit(db: Db, key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

/** Deletes windows that started before `before`. Returns how many. */
export async function pruneRateLimits(db: Db, before: number): Promise<number> {
  const rows = await db.delete(rateLimits).where(lt(rateLimits.windowStart, before)).returning({ key: rateLimits.key });
  return rows.length;
}
