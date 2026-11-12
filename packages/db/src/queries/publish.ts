import { and, asc, desc, eq, gt, isNotNull, isNull, lte, ne, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../client";
import {
  config,
  configHistory,
  type Deployment,
  type DeploymentKind,
  type DeploymentStatus,
  type DeploymentWorker,
  deployments,
  domains,
  type PublishLock,
  publishLock,
  type SiteFile,
  siteFiles,
} from "../schema";

const ROW = 1;
// 6 columns per file, and D1 allows 100 bound parameters per statement (`commitPublish` adds 2 for its guard).
const FILES_PER_STATEMENT = 16;

function forHost(host: string | null): SQL {
  return host === null ? isNull(siteFiles.host) : eq(siteFiles.host, host);
}

/** The full publish manifest: every deployed file. A full read on purpose: each publish sends all of it. */
export function listSiteFiles(db: Db): Promise<SiteFile[]> {
  return db.select().from(siteFiles).orderBy(asc(siteFiles.path));
}

/** One host's files; `null` is the shared catalog. */
export function listSiteFilesByHost(db: Db, host: string | null): Promise<SiteFile[]> {
  return db.select().from(siteFiles).where(forHost(host)).orderBy(asc(siteFiles.path));
}

export type NewSiteFile = Pick<SiteFile, "path" | "hash" | "size" | "contentType">;

/**
 * Makes `files` the complete set of one host's files (`null`: the catalog), atomically: files no longer listed
 * are dropped from the manifest.
 */
export async function replaceSiteFiles(
  db: Db,
  input: { host: string | null; files: readonly NewSiteFile[]; now: number },
): Promise<void> {
  const remove = db.delete(siteFiles).where(forHost(input.host));
  const upserts = [];
  for (let start = 0; start < input.files.length; start += FILES_PER_STATEMENT) {
    upserts.push(
      db
        .insert(siteFiles)
        .values(
          input.files
            .slice(start, start + FILES_PER_STATEMENT)
            .map((file) => ({ ...file, host: input.host, updatedAt: input.now })),
        )
        .onConflictDoUpdate({
          target: siteFiles.path,
          set: {
            host: sql`excluded.host`,
            hash: sql`excluded.hash`,
            size: sql`excluded.size`,
            contentType: sql`excluded.content_type`,
            updatedAt: sql`excluded.updated_at`,
          },
        }),
    );
  }
  await db.batch([remove, ...upserts]);
}

/** Drops one host's files from the manifest (remove domain). Returns how many. */
export async function deleteSiteFilesByHost(db: Db, host: string | null): Promise<number> {
  const rows = await db.delete(siteFiles).where(forHost(host)).returning({ path: siteFiles.path });
  return rows.length;
}

export async function insertDeployment(
  db: Db,
  input: {
    worker: DeploymentWorker;
    kind: DeploymentKind;
    host?: string;
    releaseVersion?: string;
    now: number;
  },
): Promise<Deployment> {
  const rows = await db
    .insert(deployments)
    .values({
      worker: input.worker,
      kind: input.kind,
      host: input.host ?? null,
      releaseVersion: input.releaseVersion ?? null,
      startedAt: input.now,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error("deployment insert returned no row");
  return row;
}

/** Closes a running deployment. False when it is unknown or already finished. Does not release the lock. */
export async function finishDeployment(
  db: Db,
  input: { id: number; status: "done" | "failed"; cfVersionId?: string; error?: string; now: number },
): Promise<boolean> {
  const rows = await db
    .update(deployments)
    .set({
      status: input.status,
      cfVersionId: input.cfVersionId ?? null,
      error: input.error ?? null,
      finishedAt: input.now,
    })
    .where(and(eq(deployments.id, input.id), eq(deployments.status, "running")))
    .returning({ id: deployments.id });
  return rows.length === 1;
}

export function getDeployment(db: Db, id: number): Promise<Deployment | undefined> {
  return db.select().from(deployments).where(eq(deployments.id, id)).get();
}

/** A Worker's deployments, newest first, optionally only those with one status. */
export function listDeployments(
  db: Db,
  input: { worker: DeploymentWorker; status?: DeploymentStatus; host?: string; limit?: number },
): Promise<Deployment[]> {
  return db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.worker, input.worker),
        input.status === undefined ? undefined : eq(deployments.status, input.status),
        input.host === undefined ? undefined : eq(deployments.host, input.host),
      ),
    )
    .orderBy(desc(deployments.startedAt), desc(deployments.id))
    .limit(input.limit ?? 20);
}

export async function latestDeployment(
  db: Db,
  input: { worker: DeploymentWorker; status?: DeploymentStatus; host?: string },
): Promise<Deployment | undefined> {
  const rows = await listDeployments(db, { ...input, limit: 1 });
  return rows[0];
}

/**
 * The pages Worker deployment that last changed which version is live: a finished publish or rollback, or a failed
 * publish whose version went live before it could be recorded. Newest by when it finished.
 */
export function latestLiveChange(db: Db): Promise<Deployment | undefined> {
  return db
    .select()
    .from(deployments)
    .where(and(eq(deployments.worker, "sites"), isNotNull(deployments.cfVersionId)))
    .orderBy(desc(deployments.finishedAt), desc(deployments.id))
    .limit(1)
    .get();
}

export function getPublishLock(db: Db): Promise<PublishLock | undefined> {
  return db.select().from(publishLock).where(eq(publishLock.id, ROW)).get();
}

/**
 * Takes the publish lock for a deployment, in one statement: true when it was free or its holder's time ran out
 * (a crashed publish cannot block forever). False while another deployment holds it.
 */
export async function acquirePublishLock(
  db: Db,
  input: { deploymentId: number; ttlMs: number; now: number },
): Promise<boolean> {
  const rows = await db
    .insert(publishLock)
    .values({ id: ROW, deploymentId: input.deploymentId, expiresAt: input.now + input.ttlMs })
    .onConflictDoUpdate({
      target: publishLock.id,
      set: { deploymentId: sql`excluded.deployment_id`, expiresAt: sql`excluded.expires_at` },
      setWhere: lte(publishLock.expiresAt, input.now),
    })
    .returning({ deploymentId: publishLock.deploymentId });
  return rows.length === 1;
}

/** Releases the lock if this deployment holds it. False when it does not (expired and taken over, or released). */
export async function releasePublishLock(db: Db, deploymentId: number): Promise<boolean> {
  const rows = await db
    .delete(publishLock)
    .where(and(eq(publishLock.id, ROW), eq(publishLock.deploymentId, deploymentId)))
    .returning({ id: publishLock.id });
  return rows.length === 1;
}

/**
 * Extends the lock if this deployment still holds it and its time has not run out. True means nobody else can
 * take the lock for another `ttlMs`, so it is also the check to make before a write that needs the lock.
 */
export async function renewPublishLock(
  db: Db,
  input: { deploymentId: number; ttlMs: number; now: number },
): Promise<boolean> {
  const rows = await db
    .update(publishLock)
    .set({ expiresAt: input.now + input.ttlMs })
    .where(
      and(
        eq(publishLock.id, ROW),
        eq(publishLock.deploymentId, input.deploymentId),
        gt(publishLock.expiresAt, input.now),
      ),
    )
    .returning({ id: publishLock.id });
  return rows.length === 1;
}

/** What one host looks like after a publish. No files: the host is unpublished. */
export type PublishedHost = {
  host: string;
  files: readonly NewSiteFile[];
  /**
   * Set when the files were rendered from the draft: it becomes the live config, with a history row, and the
   * draft too while the stored draft is still `rendered` (the one these files came from).
   */
  published?: { json: string; schemaVersion: number; rendered: { json: string; schemaVersion: number } };
  /** True when the files were rendered again from the live config: only the release they were built with changes. */
  rerendered?: boolean;
};

/** True while `deploymentId` is running and holds the lock, evaluated by each statement of the commit batch. */
function holdsCommit(deploymentId: number): SQL {
  return sql`exists (select 1 from ${deployments} where ${deployments.id} = ${deploymentId} and ${deployments.status} = 'running')
    and exists (select 1 from ${publishLock} where ${publishLock.id} = 1 and ${publishLock.deploymentId} = ${deploymentId})`;
}

/**
 * Records a version that is now live, in one transaction: each host's files in the manifest, a published draft as
 * the live config, the release the pages were rendered with, and, with `finish`, the deployment as done and the
 * lock released. Every statement applies only while the deployment is still running and holds the lock, so a
 * publish that was taken over writes nothing. False when it did not apply.
 */
export async function commitPublish(
  db: Db,
  input: {
    deploymentId: number;
    /** Null when nothing was deployed: a removal that left no file to publish. */
    versionId: string | null;
    hosts: readonly PublishedHost[];
    release: string | null;
    finish: boolean;
    now: number;
  },
): Promise<boolean> {
  const { now, release } = input;
  const held = holdsCommit(input.deploymentId);
  const check = db
    .select({ held: sql<number>`1` })
    .from(publishLock)
    .where(and(eq(publishLock.id, ROW), held));
  const statements: BatchItem<"sqlite">[] = [];
  for (const entry of input.hosts) {
    const { host, published } = entry;
    statements.push(db.delete(siteFiles).where(and(eq(siteFiles.host, host), held)));
    for (let start = 0; start < entry.files.length; start += FILES_PER_STATEMENT) {
      const rows = entry.files
        .slice(start, start + FILES_PER_STATEMENT)
        .map((file) => sql`(${file.path}, ${host}, ${file.hash}, ${file.size}, ${file.contentType}, ${now})`);
      // Columns in table order: path, host, hash, size, content_type, updated_at.
      statements.push(
        db.insert(siteFiles).select(sql`select * from (values ${sql.join(rows, sql`, `)}) where ${held}`),
      );
    }
    if (published !== undefined) {
      const { json, schemaVersion, rendered } = published;
      statements.push(
        db
          .update(config)
          .set({ liveJson: json, liveSchemaVersion: schemaVersion, publishedAt: now, publishedRelease: release })
          .where(and(eq(config.host, host), held)),
        db
          .update(config)
          .set({ draftJson: json, draftSchemaVersion: schemaVersion })
          .where(
            and(
              eq(config.host, host),
              eq(config.draftJson, rendered.json),
              eq(config.draftSchemaVersion, rendered.schemaVersion),
              held,
            ),
          ),
        db.insert(configHistory).select(sql`select null, ${host}, ${json}, ${schemaVersion}, ${now} where ${held}`),
        db
          .update(domains)
          .set({ status: "live", turnedOffAt: null, removedAt: null, updatedAt: now })
          .where(and(eq(domains.host, host), ne(domains.status, "live"), held)),
      );
    } else if (entry.rerendered) {
      statements.push(
        db
          .update(config)
          .set({ publishedRelease: release })
          .where(and(eq(config.host, host), held)),
      );
    }
  }
  if (input.finish) {
    statements.push(
      db
        .update(deployments)
        .set({ status: "done", cfVersionId: input.versionId, error: null, finishedAt: now })
        .where(and(eq(deployments.id, input.deploymentId), held)),
      db.delete(publishLock).where(and(eq(publishLock.id, ROW), eq(publishLock.deploymentId, input.deploymentId))),
    );
  }
  const [result] = await db.batch([check, ...statements]);
  return result.length === 1;
}
