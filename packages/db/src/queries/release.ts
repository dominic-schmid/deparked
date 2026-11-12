import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { type ReleaseState, releaseState } from "../schema";

const ROW = 1;

export function getReleaseState(db: Db): Promise<ReleaseState | undefined> {
  return db.select().from(releaseState).where(eq(releaseState.id, ROW)).get();
}

export type ReleaseStatePatch = Partial<Omit<ReleaseState, "id">>;

/** Creates the row when it is missing, then sets the given columns. */
export async function updateReleaseState(db: Db, patch: ReleaseStatePatch): Promise<void> {
  await db
    .insert(releaseState)
    .values({ id: ROW, ...patch })
    .onConflictDoUpdate({ target: releaseState.id, set: patch });
}
