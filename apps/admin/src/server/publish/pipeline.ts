import { CONFIG_VERSION, type ConfigErrors, parseConfig } from "@deparked/config";
import {
  acquirePublishLock,
  type ConfigHistoryEntry,
  commitPublish,
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
  latestLiveChange,
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
  /** Upload batches per `hosting.publish` call, at most. Default `UPLOAD_BATCHES_PER_STEP`. */
  maxUploadBatches?: number;
};

/**
 * One step is one request to the admin Worker, and a request may take a while when Cloudflare is slow. The lock
 * is renewed at the start of every step and before every write, so five minutes only has to cover one step.
 */
export const LOCK_TTL_MS = 5 * 60_000;
/**
 * Rendering and hashing one lander takes about 2 ms of CPU once the code is warm and about 14 ms the first time in
 * a fresh process (README "Publish"), so a step renders one and stays near Workers Free's 10 ms.
 */
export const HOSTS_PER_STEP = 1;
/**
 * Subrequests one step may make: every request to the host, in every round, plus every release download. Workers
 * Free allows 50; the rest is headroom for the adapter's retries.
 */
export const STEP_REQUEST_BUDGET = 40;
/** Requests one `hosting.publish` call makes besides its upload batches (session, deploy, version id). */
const PUBLISH_CALL_REQUESTS = 3;
/**
 * Upload batches per `hosting.publish` call, at most. Each batch carries as many files as the rest of the step's
 * budget can download, so few large batches send the most files per step.
 */
export const UPLOAD_BATCHES_PER_STEP = 2;
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
      reason: "busy" | FailureReason;
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

/** A removal is an `update` of one host: it renders that host from its live state, which for an off domain is nothing. */
const KIND: Record<StartKind, DeploymentKind> = {
  draft: "publish",
  placeholder: "install",
  remove: "update",
  "republish-all": "update",
};

const NO_PROGRESS: PublishProgress = { uploaded: 0, pending: 0, remainingHosts: 0, requests: 0 };
const BUSY = "Another publish is running. Wait for it to finish, then try again.";
const CRASHED = "This publish stopped before it finished. Nothing was changed; publish again.";
const LOCK_LOST = "This publish took too long and another one took over. Publish again.";
const LIVE_NOT_RECORDED =
  "The new pages went live, but another publish took over before they were recorded here. Publish again so this admin matches what visitors see.";

const NO_UPLOAD =
  "The upload stopped without sending a file, so this publish stopped instead of trying again forever. Nothing was changed; publish again.";

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

async function fail(
  ctx: PublishContext,
  deploymentId: number,
  error: unknown,
  progress = NO_PROGRESS,
  /** A version the host put live that D1 does not describe: kept, so `getPublishState` reports `outOfSync`. */
  cfVersionId?: string,
) {
  const failure = toFailure(error);
  await finishDeployment(ctx.db, {
    id: deploymentId,
    status: "failed",
    error: failure.message,
    ...(cfVersionId === undefined ? {} : { cfVersionId }),
    now: ctx.now(),
  });
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
export async function startPublish(
  ctx: PublishContext,
  input: { host?: string; kind: StartKind },
): Promise<StartResult> {
  const { host, kind } = input;
  if (kind === "republish-all") return begin(ctx, { kind: KIND[kind] });

  const domain = host === undefined ? undefined : await getDomain(ctx.db, host);
  if (host === undefined || domain === undefined) {
    return { ok: false, reason: "invalid", message: "This domain is not managed here." };
  }
  const gone = isOff(domain.status);
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

const isOff = (status: string) => status === "off" || status === "removed";

async function plan(ctx: PublishContext, deployment: Deployment, rows: readonly SiteFile[]): Promise<Plan> {
  if (deployment.kind === "update" && deployment.host === null) {
    const renderedAt = new Map<string, number>();
    for (const row of rows) {
      if (row.host !== null) renderedAt.set(row.host, Math.max(renderedAt.get(row.host) ?? 0, row.updatedAt));
    }
    // A host is finished once its rows are newer than this deployment, so the progress survives between requests.
    const pending = (await listDomains(ctx.db, { includeRemoved: true })).filter((domain) =>
      isOff(domain.status) ? renderedAt.has(domain.host) : (renderedAt.get(domain.host) ?? -1) < deployment.startedAt,
    );
    const now = pending.slice(0, ctx.hostsPerStep ?? HOSTS_PER_STEP);
    return {
      hosts: now.map((domain) => ({ host: domain.host, source: "live" })),
      remaining: pending.length - now.length,
    };
  }
  const { host } = deployment;
  if (host === null || deployment.kind === "rollback") {
    throw new PublishFailure("invalid", "This publish cannot be continued. Start it again.");
  }
  // The status decides what gets rendered, so it has to be the one this publish was started for.
  const domain = await getDomain(ctx.db, host);
  const off = domain === undefined || isOff(domain.status);
  if (deployment.kind === "update" && !off) {
    throw new PublishFailure("invalid", `${host} was turned on again, so its pages were not taken down.`);
  }
  if (deployment.kind !== "update" && off) {
    throw new PublishFailure("invalid", `${host} was turned off while it was being published. Nothing was published.`);
  }
  return { hosts: [{ host, source: deployment.kind === "publish" ? "draft" : "live" }], remaining: 0 };
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
    const running = (message: string): StepResult => ({ status: "running", progress, message });
    // A step that sent nothing would be followed by an identical one: fail instead of answering `running` forever.
    const uploading = async (message: string): Promise<StepResult> =>
      progress.uploaded > 0
        ? running(message)
        : fail(ctx, deploymentId, new PublishFailure("hosting", NO_UPLOAD), progress);

    for (let round = 0; ; round += 1) {
      const room = STEP_REQUEST_BUDGET - progress.requests - PUBLISH_CALL_REQUESTS;
      // Every batch is one request plus at most `maxFilesPerUpload` release downloads, so all of them fit in `room`.
      const maxUploadBatches = Math.min(ctx.maxUploadBatches ?? UPLOAD_BATCHES_PER_STEP, Math.floor(room / 2));
      if (maxUploadBatches < 1) return await uploading("Uploading: continuing in the next step.");
      const maxFilesPerUpload = Math.floor((room - maxUploadBatches) / maxUploadBatches);
      const downloadsAllowed = maxUploadBatches * maxFilesPerUpload;
      let downloads = 0;
      let asked = 0;

      const kept = rows.filter((row) => row.host === null || !builds.has(row.host));
      const fresh = [...builds.values()].flatMap((build) => build.files);
      const keptByPath = new Map(kept.map((row) => [row.path, row]));
      const freshByPath = new Map(fresh.map((file) => [file.path, file]));

      const getContent = async (path: string): Promise<Uint8Array> => {
        asked += 1;
        const rendered = freshByPath.get(path);
        if (rendered !== undefined) return rendered.content;
        const row = keptByPath.get(path);
        if (row === undefined) throw new PublishFailure("unexpected", `${path} is not part of this publish.`);
        if (row.host === null) {
          if (downloads === downloadsAllowed) {
            throw new PublishFailure("hosting", "The host asked for more files than one step can send. Publish again.");
          }
          downloads += 1;
          const content = await ctx.fetchReleaseFile(path, row.size);
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

      if (!(await holdsLock()))
        return await fail(ctx, deploymentId, new PublishFailure("lock-lost", LOCK_LOST), progress);
      let result: Awaited<ReturnType<HostingAdapter["publish"]>>;
      try {
        result = await ctx.hosting.publish({
          files: [...kept, ...fresh].map(toPublishFile),
          getContent,
          headers: ctx.headers,
          maxUploadBatches,
          maxFilesPerUpload,
        });
      } catch (error) {
        if (!(error instanceof StaleHost)) throw error;
        // The call stopped inside `getContent`: the session request, and at most one upload batch per file asked
        // for before this one (every batch asks for at least one).
        progress.requests += Math.min(1 + maxUploadBatches, asked) + downloads;
        if (round === MAX_STALE_ROUNDS) {
          throw new PublishFailure(
            "invalid",
            "Several domains were built with an older version. Use “Republish all” once, then publish again.",
          );
        }
        // The templates changed since that host was published: its pages join this deploy and its rows are replaced.
        builds.set(error.build.host, error.build);
        continue;
      }
      progress.requests += result.requests + downloads;
      progress.uploaded += result.uploaded.length;
      if (!result.done) {
        progress.pending = result.pending;
        return await uploading(`Uploading: ${result.pending} files to go.`);
      }

      const committed = await commitPublish(db, {
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
      if (!committed) {
        // Another request of this same publish may have recorded it first; then it is simply done.
        const current = await getDeployment(db, deploymentId);
        if (current?.status === "done") {
          return { status: "done", progress, message: "Published.", versionId: current.cfVersionId };
        }
        const lost = new PublishFailure("lock-lost", LIVE_NOT_RECORDED);
        return await fail(ctx, deploymentId, lost, progress, result.versionId);
      }
      progress.remainingHosts = remaining;
      return remaining === 0
        ? { status: "done", progress, message: "Published.", versionId: result.versionId }
        : running(`Rebuilding: ${remaining} domains to go.`);
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
  if (versionId === null)
    return { ok: false, reason: "invalid", message: "This publish has no version to go back to." };

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
  if (!started.ok) return started;
  try {
    await saveDraft(ctx.db, { host: entry.host, json: entry.json, schemaVersion: entry.schemaVersion, now: ctx.now() });
  } catch (error) {
    const failure = await fail(ctx, started.deploymentId, error);
    return { ok: false, reason: failure.reason, message: failure.message, deploymentId: started.deploymentId };
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
  /**
   * True when visitors get another version than the database describes: after an emergency rollback, or after a
   * publish whose version went live but could not be recorded. The next publish that finishes clears it.
   */
  outOfSync: boolean;
};

export async function getPublishState(input: { db: Db; now: () => number }, host: string): Promise<PublishState> {
  const { db } = input;
  const [stored, last, lock, liveChange] = await Promise.all([
    getConfig(db, host),
    latestDeployment(db, { worker: "sites", host }),
    getPublishLock(db),
    latestLiveChange(db),
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
    outOfSync: liveChange !== undefined && (liveChange.kind === "rollback" || liveChange.status === "failed"),
  };
}

/** A domain's published configs, newest first, for the Revert list. */
export function listHistory(db: Db, host: string): Promise<ConfigHistoryEntry[]> {
  return listConfigHistory(db, { host });
}
