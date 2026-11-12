import { desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type Config, type ConfigHistoryEntry, config, configHistory } from "../schema";

/** The draft and live config of a host. The JSON is as stored: validate it with `packages/config`. */
export function getConfig(db: Db, host: string): Promise<Config | undefined> {
  return db.select().from(config).where(eq(config.host, host)).get();
}

/** When each host was last published (null: never). A full read of `config` on purpose: one row per domain. */
export function listPublishedAt(db: Db): Promise<{ host: string; publishedAt: number | null }[]> {
  return db.select({ host: config.host, publishedAt: config.publishedAt }).from(config);
}

export async function saveDraft(
  db: Db,
  input: { host: string; json: string; schemaVersion: number; now: number },
): Promise<void> {
  await db
    .insert(config)
    .values({ host: input.host, draftJson: input.json, draftSchemaVersion: input.schemaVersion, updatedAt: input.now })
    .onConflictDoUpdate({
      target: config.host,
      set: { draftJson: input.json, draftSchemaVersion: input.schemaVersion, updatedAt: input.now },
    });
}

/**
 * Records a publish: `json` (exactly what was rendered and deployed) becomes the live config and a history row,
 * atomically. The draft is left alone, so edits made while the publish ran still show as a diff. A host without a
 * config row gets one, with the published config as its draft too.
 */
export async function publishConfig(
  db: Db,
  input: { host: string; json: string; schemaVersion: number; release: string | null; now: number },
): Promise<void> {
  const live = {
    liveJson: input.json,
    liveSchemaVersion: input.schemaVersion,
    publishedAt: input.now,
    publishedRelease: input.release,
  };
  await db.batch([
    db
      .insert(config)
      .values({
        host: input.host,
        draftJson: input.json,
        draftSchemaVersion: input.schemaVersion,
        updatedAt: input.now,
        ...live,
      })
      .onConflictDoUpdate({ target: config.host, set: live }),
    db
      .insert(configHistory)
      .values({ host: input.host, json: input.json, schemaVersion: input.schemaVersion, publishedAt: input.now }),
  ]);
}

/** Published versions of a host, newest first. For Revert: save one as the draft, then publish. */
export function listConfigHistory(db: Db, input: { host: string; limit?: number }): Promise<ConfigHistoryEntry[]> {
  return db
    .select()
    .from(configHistory)
    .where(eq(configHistory.host, input.host))
    .orderBy(desc(configHistory.publishedAt), desc(configHistory.id))
    .limit(input.limit ?? 50);
}

export function getConfigHistoryEntry(db: Db, id: number): Promise<ConfigHistoryEntry | undefined> {
  return db.select().from(configHistory).where(eq(configHistory.id, id)).get();
}
