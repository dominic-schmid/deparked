import { CONFIG_VERSION, type ConfigErrors, parseConfig } from "@deparked/config";
import {
  acquirePublishLock,
  commitPublish,
  type ConfigHistoryEntry,
  type Db,
  type Deployment,
  type DeploymentKind,
  finishDeployment,
  getConfig,
  getConfigHistoryEntry,
  getDeployment,
  getDomain,
  getPublishLock,
  insertDeployment,
  latestDeployment,
  listConfigHistory,
  listDeployments,
  listDomains,
  listSiteFiles,
  releasePublishLock,
  renewPublishLock,
  type SiteFile,
  saveDraft,
} from "@deparked/db";
import { contentHash, type HostingAdapter, HostingError, type PublishFile } from "@deparked/hosting";
import type { Catalog } from "@deparked/templates";
import { buildHost, type FailureReason, type HostBuild, PublishFailure } from "./files";
import type { FetchReleaseFile } from "./release";

/** Everything a publish needs. Built per request by the server functions; tests pass fakes. */
export type PublishContext = {
  db: Db;
  hosting: HostingAdapter;
  now: () => number;
  /** The installed release's `/catalog/catalog.json`, for rendering. */
  catalog: Catalog;
  /** The `_headers` rules of the pages Worker, sent with every version. */
  headers: string;
  /** The installed release, recorded with what it rendered. Null in local dev. */
  release: string | null;
  fetchReleaseFile: FetchReleaseFile;
  /** Hosts rendered per step of "republish all". Default `HOSTS_PER_STEP`. */
  hostsPerStep?: number;
  /** Upload requests per step. Default `UPLOAD_BATCHES_PER_STEP`. */
  maxUploadBatches?: number;
};

/**
 * One step is one request to the admin Worker, and a request may take a while when Cloudflare is slow. The lock
 * is renewed at the start of every step and before every write, so five minutes only has to cover one step.
 */
export const LOCK_TTL_MS = 5 * 60_000;
/**
 * Rendering and hashing one lander takes about 2.5 ms of CPU once the code is warm and several times that in a
 * fresh isolate (README "Publish"), so a step renders one and stays inside Workers Free's 10 ms.
 */
export const HOSTS_PER_STEP = 1;
/** With the three fixed requests and up to `MAX_STALE_ROUNDS` restarted upload sessions, a step stays under 50. */
export const UPLOAD_BATCHES_PER_STEP = 30;
/** How often one step starts over because another domain's pages turned out to be stale. */
export const MAX_STALE_ROUNDS = 3;

export type StartKind =
  /** Publish the domain's saved draft. */
  | "draft"
  /** A new domain's first page: the placeholder (or its live design again, when it has one). */
  | "placeholder"
  /** Take the files of a domain that is turned off or removed out of the pages Worker. */
  | "remove"
  /** Render every domain again, after an update or an emergency rollback. */
  | "republish-all";

export type StartResult =
  | { ok: true; deploymentId: number }
  | {
      ok: false;
      /** `busy`: another publish holds the lock (`deploymentId` says which). */
      reason: "busy" | "invalid" | "credentials-rejected" | "hosting";
      message: string;
      deploymentId?: number;
    };

export type PublishProgress = {
  /** Files sent to the host in this step. */
  uploaded: number;
  /** Files the host still waits for. */
  pending: number;
  /** Domains still to render ("republish all"). */
  remainingHosts: number;
  /** Requests to the host in this step. */
  requests: number;
};

export type StepResult =
  | { status: "running"; progress: PublishProgress; message: string }
  | { status: "done"; progress: PublishProgress; message: string; versionId: string | null }
  | {
      status: "failed";
      /** `credentials-rejected`: show the "Replace token" banner. `earlier`: it had failed before this call. */
      reason: FailureReason | "earlier";
      progress: PublishProgress;
      message: string;
    };

const KIND: Record<StartKind, DeploymentKind> = {
  draft: "publish",
  placeholder: "install",
  remove: "publish",
  "republish-all": "update",
};

const NO_PROGRESS: PublishProgress = { uploaded: 0, pending: 0, remainingHosts: 0, requests: 0 };
const BUSY = "Another publish is running. Wait for it to finish, then try again.";
const CRASHED = "This publish stopped before it finished. Nothing was changed; publish again.";
const LOCK_LOST = "This publish took too long and another one took over. Publish again.";

/** Another domain's file was asked for, and rendering it again gives different bytes than the manifest lists. */
class StaleHost extends Error {
  readonly build: HostBuild;

  constructor(build: HostBuild) {
    super(`${build.host} is stale`);
    this.build = build;
  }
}

function toFailure(error: unknown): { reason: FailureReason; message: string } {
  if (error instanceof PublishFailure) return { reason: error.reason, message: error.message };
  if (error instanceof HostingError) {
    return { reason: error.credentialsRejected ? "credentials-rejected" : "hosting", message: error.message };
  }
  return { reason: "unexpected", message: "The publish failed unexpectedly. Nothing was changed; publish again." };
}

async function fail(ctx: PublishContext, deploymentId: number, error: unknown, progress = NO_PROGRESS) {
  const failure = toFailure(error);
  await finishDeployment(ctx.db, { id: deploymentId, status: "failed", error: failure.message, now: ctx.now() });
  await releasePublishLock(ctx.db, deploymentId);
  return { status: "failed" as const, ...failure, progress };
}

/**
 * Marks publishes that died (still `running`, but not holding a valid lock) as failed. Returns the deployment
 * that holds the lock now, if any.
 */
async function recoverCrashed(ctx: PublishContext): Promise<number | undefined> {
  const now = ctx.now();
  const lock = await getPublishLock(ctx.db);
  const holder = lock !== undefined && lock.expiresAt > now ? lock.deploymentId : undefined;
  const running = await listDeployments(ctx.db, { worker: "sites", status: "running" });
  for (const deployment of running) {
    if (deployment.id !== holder) {
      await finishDeployment(ctx.db, { id: deployment.id, status: "failed", error: CRASHED, now });
    }
  }
  return holder;
}

/** Inserts the deployment and takes the lock for it, or says who holds it. */
async function begin(
  ctx: PublishContext,
  input: { kind: DeploymentKind; host?: string },
): Promise<{ ok: true; deploymentId: number } | { ok: false; reason: "busy"; message: string; deploymentId?: number }> {
  const holder = await recoverCrashed(ctx);
  if (holder !== undefined) return { ok: false, reason: "busy", message: BUSY, deploymentId: holder };
  const now = ctx.now();
  const deployment = await insertDeployment(ctx.db, {
    worker: "sites",
    kind: input.kind,
    ...(input.host === undefined ? {} : { host: input.host }),
    ...(ctx.release === null ? {} : { releaseVersion: ctx.release }),
    now,
  });
  if (!(await acquirePublishLock(ctx.db, { deploymentId: deployment.id, ttlMs: LOCK_TTL_MS, now }))) {
    await finishDeployment(ctx.db, { id: deployment.id, status: "failed", error: BUSY, now });
    return { ok: false, reason: "busy", message: BUSY };
  }
  return { ok: true, deploymentId: deployment.id };
}

/**
 * Starts a publish: records it and takes the publish lock. Nothing is rendered or sent yet; call `stepPublish`
 * with the returned id until it answers `done` or `failed`.
 */
export async function startPublish(ctx: PublishContext, input: { host?: string; kind: StartKind }): Promise<StartResult> {
  const { host, kind } = input;
  if (kind === "republish-all") return begin(ctx, { kind: KIND[kind] });

  const domain = host === undefined ? undefined : await getDomain(ctx.db, host);
  if (host === undefined || domain === undefined) {
    return { ok: false, reason: "invalid", message: "This domain is not managed here." };
  }
  const gone = domain.status === "off" || domain.status === "removed";
  if (kind === "remove" && !gone) {
    return { ok: false, reason: "invalid", message: `Turn ${host} off before its pages are taken down.` };
  }
  if (kind !== "remove" && gone) {
    return { ok: false, reason: "invalid", message: `${host} is turned off. Turn it on before publishing.` };
  }
  if (kind === "draft" && (await getConfig(ctx.db, host)) === undefined) {
    return { ok: false, reason: "invalid", message: `${host} has no saved design to publish yet.` };
  }
  return begin(ctx, { kind: KIND[kind], host });
}

type Plan = { hosts: { host: string; source: "draft" | "live" }[]; remaining: number };

async function plan(ctx: PublishContext, deployment: Deployment, rows: readonly SiteFile[]): Promise<Plan> {
  if (deployment.kind === "update") {
    const renderedAt = new Map<string, number>();
    for (const row of rows) {
      if (row.host !== null) renderedAt.set(row.host, Math.max(renderedAt.get(row.host) ?? 0, row.updatedAt));
    }
    // A host is finished once its rows are newer than this deployment, so the progress survives between requests.
    const pending = (await listDomains(ctx.db, { includeRemoved: true })).filter((domain) =>
      domain.status === "off" || domain.status === "removed"
        ? renderedAt.has(domain.host)
        : (renderedAt.get(domain.host) ?? -1) < deployment.startedAt,
    );
    const now = pending.slice(0, ctx.hostsPerStep ?? HOSTS_PER_STEP);
    return {
      hosts: now.map((domain) => ({ host: domain.host, source: "live" })),
      remaining: pending.length - now.length,
    };
  }
  if (deployment.host === null || (deployment.kind !== "publish" && deployment.kind !== "install")) {
    throw new PublishFailure("invalid", "This publish cannot be continued. Start it again.");
  }
  return { hosts: [{ host: deployment.host, source: deployment.kind === "publish" ? "draft" : "live" }], remaining: 0 };
}

const toPublishFile = ({ path, hash, size, contentType }: PublishFile): PublishFile => ({
  path,
  hash,
  size,
  contentType,
});

/**
 * Does one bounded piece of a publish: renders this step's hosts, sends the complete manifest to the host and,
 * when the host has put it live, records it in one transaction. Call it again while it answers `running`.
 *
 * Every call starts from the database, so nothing is carried between requests: a call that ends with files
 * still pending renders the same pages again and the host continues where the upload stopped.
 */
export async function stepPublish(ctx: PublishContext, deploymentId: number): Promise<StepResult> {
  const { db } = ctx;
  const deployment = await getDeployment(db, deploymentId);
  if (deployment === undefined || deployment.worker !== "sites") {
    return { status: "failed", reason: "invalid", progress: NO_PROGRESS, message: "This publish does not exist." };
  }
  if (deployment.status === "done") {
    return { status: "done", progress: NO_PROGRESS, message: "Published.", versionId: deployment.cfVersionId };
  }
  if (deployment.status === "failed") {
    await releasePublishLock(db, deploymentId);
    return { status: "failed", reason: "earlier", progress: NO_PROGRESS, message: deployment.error ?? CRASHED };
  }

  const holdsLock = () => renewPublishLock(db, { deploymentId, ttlMs: LOCK_TTL_MS, now: ctx.now() });
  if (!(await holdsLock())) return fail(ctx, deploymentId, new PublishFailure("lock-lost", CRASHED));

  const progress = { ...NO_PROGRESS };
  try {
    const rows = await listSiteFiles(db);
    const { hosts, remaining } = await plan(ctx, deployment, rows);
    progress.remainingHosts = hosts.length + remaining;

    const builds = new Map<string, HostBuild>();
    for (const { host, source } of hosts) builds.set(host, await buildHost(ctx, host, source));
    const others = new Map<string, HostBuild>();

    for (let round = 0; ; round += 1) {
      const kept = rows.filter((row) => row.host === null || !builds.has(row.host));
      const fresh = [...builds.values()].flatMap((build) => build.files);
      const keptByPath = new Map(kept.map((row) => [row.path, row]));
      const freshByPath = new Map(fresh.map((file) => [file.path, file]));

      const getContent = async (path: string): Promise<Uint8Array> => {
        const rendered = freshByPath.get(path);
        if (rendered !== undefined) return rendered.content;
        const row = keptByPath.get(path);
        if (row === undefined) throw new PublishFailure("unexpected", `${path} is not part of this publish.`);
        if (row.host === null) {
          const content = await ctx.fetchReleaseFile(path);
          if (content.length !== row.size || (await contentHash(path, content)) !== row.hash) {
            throw new PublishFailure("hosting", `The release's copy of ${path} is not the file that was installed.`);
          }
          return content;
        }
        const other = others.get(row.host) ?? (await buildHost(ctx, row.host, "live"));
        others.set(row.host, other);
        const again = other.files.find((file) => file.path === path);
        if (again === undefined || again.hash !== row.hash) throw new StaleHost(other);
        return again.content;
      };

      if (!(await holdsLock())) return await fail(ctx, deploymentId, new PublishFailure("lock-lost", LOCK_LOST), progress);
      let result: Awaited<ReturnType<HostingAdapter["publish"]>>;
      try {
        result = await ctx.hosting.publish({
          files: [...kept, ...fresh].map(toPublishFile),
          getContent,
          headers: ctx.headers,
          maxUploadBatches: ctx.maxUploadBatches ?? UPLOAD_BATCHES_PER_STEP,
        });
      } catch (error) {
        if (!(error instanceof StaleHost)) throw error;
        if (round === MAX_STALE_ROUNDS) {
          throw new PublishFailure(
            "invalid",
            "Several domains were built with an older version. Use “Republish all” once, then publish again.",
          );
        }
        // The templates changed since that host was published: its pages join this deploy and its rows are replaced.
        builds.set(error.build.host, error.build);
        // The abandoned upload session was at least one request.
        progress.requests += 1;
        continue;
      }
      progress.requests += result.requests;
      progress.uploaded = result.uploaded.length;
      if (!result.done) {
        progress.pending = result.pending;
        return { status: "running", progress, message: `Uploading: ${result.pending} files to go.` };
      }

      // The version is live. If the lock is gone, whoever took it publishes the manifest the database describes.
      if (!(await holdsLock())) return await fail(ctx, deploymentId, new PublishFailure("lock-lost", LOCK_LOST), progress);
      await commitPublish(db, {
        deploymentId,
        versionId: result.versionId,
        hosts: [...builds.values()].map(({ host, files, published, rerendered }) => ({
          host,
          files: files.map(toPublishFile),
          ...(published === undefined ? {} : { published }),
          ...(rerendered === undefined ? {} : { rerendered }),
        })),
        release: ctx.release,
        finish: remaining === 0,
        now: ctx.now(),
      });
      progress.remainingHosts = remaining;
      return remaining === 0
        ? { status: "done", progress, message: "Published.", versionId: result.versionId }
        : { status: "running", progress, message: `Rebuilding: ${remaining} domains to go.` };
    }
  } catch (error) {
    return fail(ctx, deploymentId, error, progress);
  }
}

/**
 * Emergency only: puts an earlier version of the pages Worker live. The database keeps describing the newest
 * publish, not what visitors get, until the next publish of any kind sends that manifest again; `getPublishState`
 * reports `outOfSync` until then. To undo a design change, use `revertTo`.
 */
export async function rollbackPublish(
  ctx: PublishContext,
  target: { versionId: string } | { deploymentId: number },
): Promise<StartResult> {
  let versionId: string | null;
  if ("versionId" in target) {
    versionId = target.versionId;
  } else {
    const earlier = await getDeployment(ctx.db, target.deploymentId);
    versionId = earlier?.worker === "sites" && earlier.status === "done" ? earlier.cfVersionId : null;
  }
  if (versionId === null) return { ok: false, reason: "invalid", message: "This publish has no version to go back to." };

  const begun = await begin(ctx, { kind: "rollback" });
  if (!begun.ok) return begun;
  try {
    const result = await ctx.hosting.rollback(versionId);
    await finishDeployment(ctx.db, {
      id: begun.deploymentId,
      status: "done",
      cfVersionId: result.versionId,
      now: ctx.now(),
    });
    await releasePublishLock(ctx.db, begun.deploymentId);
    return begun;
  } catch (error) {
    const failure = await fail(ctx, begun.deploymentId, error);
    const reason = failure.reason === "credentials-rejected" ? failure.reason : "hosting";
    return { ok: false, reason, message: failure.message, deploymentId: begun.deploymentId };
  }
}

/**
 * Makes an earlier published config the draft and starts publishing it; step the returned deployment like any
 * other. The draft the owner had is replaced.
 */
export async function revertTo(ctx: PublishContext, historyId: number): Promise<StartResult> {
  const entry = await getConfigHistoryEntry(ctx.db, historyId);
  if (entry === undefined) return { ok: false, reason: "invalid", message: "This earlier version no longer exists." };
  const started = await startPublish(ctx, { host: entry.host, kind: "draft" });
  if (started.ok) {
    await saveDraft(ctx.db, { host: entry.host, json: entry.json, schemaVersion: entry.schemaVersion, now: ctx.now() });
  }
  return started;
}

export type SaveDraftResult = { ok: true } | { ok: false; errors: ConfigErrors };

/** Validates and stores a domain's draft. Nothing is published. */
export async function saveDraftConfig(
  input: { db: Db; now: () => number },
  host: string,
  config: unknown,
): Promise<SaveDraftResult> {
  if ((await getDomain(input.db, host)) === undefined) {
    return { ok: false, errors: { form: "This domain is not managed here." } };
  }
  const result = parseConfig(config);
  if (!result.ok) return result;
  await saveDraft(input.db, {
    host,
    json: JSON.stringify(result.config),
    schemaVersion: CONFIG_VERSION,
    now: input.now(),
  });
  return { ok: true };
}

export type PublishState = {
  /** True when Publish would change the page: there is a draft and it is not what is live. */
  draftDiffers: boolean;
  publishedAt: number | null;
  /** This domain's latest publish, whatever its outcome. */
  lastDeployment: Pick<Deployment, "id" | "kind" | "status" | "error" | "startedAt" | "finishedAt"> | null;
  /** The publish running now, for any domain. */
  lock: { deploymentId: number; expiresAt: number } | null;
  /** True after an emergency rollback: visitors get an older version than the database describes. */
  outOfSync: boolean;
};

export async function getPublishState(input: { db: Db; now: () => number }, host: string): Promise<PublishState> {
  const { db } = input;
  const [stored, last, lock, lastDone] = await Promise.all([
    getConfig(db, host),
    latestDeployment(db, { worker: "sites", host }),
    getPublishLock(db),
    latestDeployment(db, { worker: "sites", status: "done" }),
  ]);
  return {
    draftDiffers:
      stored !== undefined &&
      (stored.draftJson !== stored.liveJson || stored.draftSchemaVersion !== stored.liveSchemaVersion),
    publishedAt: stored?.publishedAt ?? null,
    lastDeployment:
      last === undefined
        ? null
        : {
            id: last.id,
            kind: last.kind,
            status: last.status,
            error: last.error,
            startedAt: last.startedAt,
            finishedAt: last.finishedAt,
          },
    lock:
      lock !== undefined && lock.expiresAt > input.now()
        ? { deploymentId: lock.deploymentId, expiresAt: lock.expiresAt }
        : null,
    outOfSync: lastDone?.kind === "rollback",
  };
}

/** A domain's published configs, newest first, for the Revert list. */
export function listHistory(db: Db, host: string): Promise<ConfigHistoryEntry[]> {
  return listConfigHistory(db, { host });
}
