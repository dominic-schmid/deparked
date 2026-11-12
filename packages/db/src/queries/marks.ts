import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { rateLimits } from "../schema";
import { MARK_PREFIX } from "./mark-keys";

/**
 * One-off facts about the workspace that need no column of their own, kept as `rate_limits` rows like the
 * provisioning lock: key `mark:<name>`, `window_start` the time it was set. `pruneRateLimits` never deletes them.
 * `setup-checklist-dismissed`: the owner hid the overview's "Finish setting up" card. `offers-exported`: the
 * last time the owner started a download of every offer.
 */
export type WorkspaceMark = "setup-checklist-dismissed" | "offers-exported";

/** When the mark was last set, or null. */
export async function getWorkspaceMark(db: Db, mark: WorkspaceMark): Promise<number | null> {
  const row = await db
    .select({ at: rateLimits.windowStart })
    .from(rateLimits)
    .where(eq(rateLimits.key, `${MARK_PREFIX}${mark}`))
    .get();
  return row?.at ?? null;
}

/** Sets the mark to `now`, whether it was set before or not. */
export async function setWorkspaceMark(db: Db, input: { mark: WorkspaceMark; now: number }): Promise<void> {
  await db
    .insert(rateLimits)
    .values({ key: `${MARK_PREFIX}${input.mark}`, windowStart: input.now, count: 0 })
    .onConflictDoUpdate({ target: rateLimits.key, set: { windowStart: input.now } });
}
