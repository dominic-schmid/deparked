import { and, eq, gte, lt, sql } from "drizzle-orm";
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

/** Gives back one hit counted in the window that started at `windowStart`. A window that has moved on is left alone. */
export async function refundRateLimit(db: Db, input: { key: string; windowStart: number }): Promise<void> {
  await db
    .update(rateLimits)
    .set({ count: sql`${rateLimits.count} - 1` })
    .where(and(eq(rateLimits.key, input.key), eq(rateLimits.windowStart, input.windowStart), gte(rateLimits.count, 1)));
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

/** The installer's ownership proofs: one row each, `key` = this prefix + a random value. Never a rate limit key. */
const OWNERSHIP_PROOF_PREFIX = "install-proof:";

/**
 * Opens one ownership proof row with a fresh random key, after deleting proofs older than `ttlMs`, and returns the
 * key. Null (nothing written) when `maxOpen` proofs are open already. A proof never touches another proof's row;
 * delete it with `clearRateLimit` when done.
 */
export async function openOwnershipProof(
  db: Db,
  input: { ttlMs: number; maxOpen: number; now: number },
): Promise<string | null> {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0"));
  const key = `${OWNERSHIP_PROOF_PREFIX}${random.join("")}`;
  // A key range, not LIKE: it reads the primary key index. ";" is the character after ":".
  const ours = and(gte(rateLimits.key, OWNERSHIP_PROOF_PREFIX), lt(rateLimits.key, "install-proof;"));
  const open = db.$count(rateLimits, ours);
  const rows = await db.batch([
    db.delete(rateLimits).where(and(ours, lt(rateLimits.windowStart, input.now - input.ttlMs))),
    db
      .insert(rateLimits)
      .select(
        db
          .select({
            key: sql<string>`${key}`.as("key"),
            windowStart: sql<number>`${input.now}`.as("window_start"),
            count: sql<number>`0`.as("count"),
          })
          .from(sql`(select 1)`)
          .where(sql`${open} < ${input.maxOpen}`),
      )
      .returning({ key: rateLimits.key }),
  ]);
  return rows[1].length === 1 ? key : null;
}
