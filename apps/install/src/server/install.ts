import { CloudflareApiError, type CloudflareClient, createCloudflareClient } from "@deparked/cf";
import {
  applyMigrations,
  clearRateLimit,
  createDb,
  type Db,
  d1Runner,
  getInstallState,
  getWorkspace,
  hitRateLimit,
  initInstallState,
  openOwnershipProof,
  updateInstallState,
} from "@deparked/db";
import {
  adminUrl,
  beginRollback,
  checkTokenPermissions,
  DATABASE_NAME,
  dryRun,
  findDatabase,
  issueSetupSecret,
  type Plan,
  type ProvisionContext,
  planInstallHub,
  ReleaseError,
  releaseFromUrl,
  runNextStep,
  runReleaseStep,
  sha256Hex,
  versionAtLeast,
} from "@deparked/provision";
import type {
  Account,
  ApiError,
  CheckRequest,
  CheckResponse,
  ErrorCode,
  FinishRequest,
  FinishResponse,
  InstallProgress,
  Status,
  StepRequest,
  StepResponse,
} from "../api";
import { apiBase, type Env, INSTALLER_VERSION, releaseBaseUrl, releasePin } from "./config";

const fail = (error: ErrorCode, message: string): ApiError => ({ ok: false, error, message });

class Refusal extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const NO_RELEASE =
  "This installer was built before the first Deparked release, so there is nothing to install yet. Update your copy of the installer from the Deparked repository, then try again.";

function client(env: Env, token: string, accountId: string): CloudflareClient {
  const baseUrl = apiBase(env);
  return createCloudflareClient({ token, accountId, ...(baseUrl === undefined ? {} : { baseUrl }) });
}

function refusedToken(error: unknown): boolean {
  return error instanceof CloudflareApiError && (error.status === 401 || error.status === 403 || error.status === 400);
}

const INVALID_TOKEN =
  "Cloudflare does not accept this token. Copy it again from Cloudflare's page (it is shown only once: create a new one if you closed it), then paste it here.";

async function accountsOf(env: Env, token: string): Promise<Account[]> {
  try {
    return (await client(env, token, "none").accounts.list()).map(({ id, name }) => ({ id, name }));
  } catch (error) {
    if (refusedToken(error)) throw new Refusal("invalid-token", INVALID_TOKEN);
    throw error;
  }
}

/** The install's own tables, through the binding. Called only once ownership is proven. */
async function prepareDatabase(env: Env): Promise<Db> {
  await applyMigrations(d1Runner(env.DB));
  const db = createDb(env.DB);
  await initInstallState(db);
  return db;
}

/**
 * Before ownership is proven only the rate limit table is written. On a database the Deploy button has just made
 * it may not exist yet: the migrations create it, and only create what is missing.
 */
async function ensureRateLimits(env: Env): Promise<Db> {
  const found = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rate_limits'",
  ).all();
  if (found.results.length === 0) await applyMigrations(d1Runner(env.DB));
  return createDb(env.DB);
}

const FOREIGN_ACCOUNT =
  "This token works, but for another Cloudflare account than the one this installer runs in. Log in to the account you deployed the installer to, create the token there, then paste it here.";

const ATTEMPT_TTL_MS = 5 * 60 * 1000;
/** Proofs that may be open at once, across all callers. A crashed request leaves its row until it expires. */
const MAX_OPEN_ATTEMPTS = 20;
/** Requests that need a proof, per client address and window: an install takes about ten. */
export const ATTEMPTS_PER_WINDOW = 60;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const THROTTLED = "Too many tries from your address in a short time. Wait ten minutes, then paste the token again.";
const CROWDED = "Too many checks are running at once. Wait a minute, then try again.";

async function throttle(db: Db, clientIp: string): Promise<void> {
  const subject = await sha256Hex(new TextEncoder().encode(clientIp));
  const hit = await hitRateLimit(db, { key: `install:${subject}`, windowMs: ATTEMPT_WINDOW_MS, now: Date.now() });
  if (hit.count > ATTEMPTS_PER_WINDOW) throw new Refusal("busy", THROTTLED);
}

/**
 * The proof that the person holding the token owns this installer: a one-time value the installer writes to its
 * own database through the binding must come back when read through the API with the token. A token of another
 * account cannot read it. Each attempt writes its own row and deletes it afterwards, so a caller who is not the
 * owner changes nothing another attempt or the install depends on.
 */
async function proveOwnership(db: Db, cf: CloudflareClient): Promise<void> {
  const key = await openOwnershipProof(db, { ttlMs: ATTEMPT_TTL_MS, maxOpen: MAX_OPEN_ATTEMPTS, now: Date.now() });
  if (key === null) throw new Refusal("busy", CROWDED);
  try {
    const databaseId = await findDatabase({ cf } as ProvisionContext, DATABASE_NAME);
    if (databaseId === null) throw new Refusal("foreign-account", FOREIGN_ACCOUNT);
    const [result] = await cf.d1.query(databaseId, "SELECT key FROM rate_limits WHERE key = ?", [key]);
    if (result?.results[0]?.key !== key) throw new Refusal("foreign-account", FOREIGN_ACCOUNT);
  } catch (error) {
    // 404: the token cannot see the database or the account. 400: a database of that name without our tables, in
    // another account.
    if (error instanceof CloudflareApiError && (error.status === 404 || error.status === 400)) {
      throw new Refusal("foreign-account", FOREIGN_ACCOUNT);
    }
    throw error;
  } finally {
    await clearRateLimit(db, key);
  }
}

interface Session {
  db: Db;
  cf: CloudflareClient;
  ctx: ProvisionContext;
  plan: Plan;
}

async function openSession(env: Env, input: { token: string; accountId: string; clientIp: string }): Promise<Session> {
  const pin = releasePin(env);
  if (pin === null) throw new Refusal("no-release", NO_RELEASE);
  const cf = client(env, input.token, input.accountId);
  const guard = await ensureRateLimits(env);
  await throttle(guard, input.clientIp);
  try {
    await proveOwnership(guard, cf);
  } catch (error) {
    if (refusedToken(error)) throw new Refusal("invalid-token", INVALID_TOKEN);
    throw error;
  }
  const db = await prepareDatabase(env);
  const ctx: ProvisionContext = { cf, db, now: Date.now };
  const release = releaseFromUrl({ baseUrl: releaseBaseUrl(env, pin), pinnedSha256: pin.sha256 });
  const manifest = await release.manifest();
  if (manifest.version !== pin.version) {
    throw new Refusal("release", `release.json says ${manifest.version}, but the installer pins ${pin.version}.`);
  }
  if (!versionAtLeast(INSTALLER_VERSION, manifest.minInstallerVersion)) {
    throw new Refusal(
      "release",
      `Deparked ${manifest.version} needs installer ${manifest.minInstallerVersion} or newer; this one is ${INSTALLER_VERSION}. Update your copy of the installer from the Deparked repository.`,
    );
  }
  return { db, cf, ctx, plan: planInstallHub(ctx, { release, token: input.token }) };
}

/** Turns what went wrong into an answer for the page. Unknown errors stay generic: they may name internals. */
function answer(error: unknown): ApiError {
  if (error instanceof Refusal) return fail(error.code, error.message);
  if (error instanceof ReleaseError) return fail("release", error.message);
  if (error instanceof CloudflareApiError) {
    return fail("cloudflare", `Cloudflare did not answer as expected (${error.message}). Try again in a moment.`);
  }
  console.error("installer: unexpected error", error instanceof Error ? error.name : typeof error);
  return fail(
    "cloudflare",
    "Something went wrong on the installer's side. Try again; if it keeps happening, open an issue.",
  );
}

export async function check(env: Env, input: CheckRequest, clientIp: string): Promise<CheckResponse> {
  try {
    const accounts = await accountsOf(env, input.token);
    if (accounts.length === 0) {
      return fail(
        "no-account",
        "This token reaches no Cloudflare account. Create it with “All accounts” or with this account selected.",
      );
    }
    const account =
      accounts.find((entry) => entry.id === input.accountId) ?? (accounts.length === 1 ? accounts[0] : undefined);
    if (account === undefined) return { ok: true, status: "pick-account", accounts };
    const cf = client(env, input.token, account.id);
    const status = await cf.tokens.verify().catch((error: unknown) => {
      if (refusedToken(error)) throw new Refusal("invalid-token", INVALID_TOKEN);
      throw error;
    });
    if (status.status !== "active") {
      return fail(
        "invalid-token",
        `This token is ${status.status}. Create a new one on Cloudflare's page, then paste it here.`,
      );
    }
    const permissions = await checkTokenPermissions(cf);
    if (permissions.missing.some((entry) => entry.label === "D1" || entry.label === "Workers Scripts")) {
      return { ok: true, status: "ready", account, release: "", ...permissions, steps: [], nothingToDo: false };
    }
    const session = await openSession(env, { token: input.token, accountId: account.id, clientIp });
    const report = await dryRun(session.plan);
    return {
      ok: true,
      status: "ready",
      account,
      release: releasePin(env)?.version ?? "",
      ...permissions,
      steps: report.steps.map((step) =>
        step.status === "blocked"
          ? { id: step.id, title: step.title, status: "blocked", effects: [], reason: step.reason }
          : { id: step.id, title: step.title, status: step.status, effects: step.effects },
      ),
      nothingToDo: report.nothingToDo,
      progress: await progress(session.db),
    };
  } catch (error) {
    return answer(error);
  }
}

export async function step(env: Env, input: StepRequest, clientIp: string): Promise<StepResponse> {
  try {
    const session = await openSession(env, { token: input.token, accountId: input.accountId, clientIp });
    const state = await getInstallState(session.db);
    if (state?.startedAt == null) await updateInstallState(session.db, { startedAt: Date.now(), finishedAt: null });
    const report = await runNextStep(session.plan, { next: input.next });
    if (report.step !== null) {
      const failed = report.outcome === "failed" || report.outcome === "blocked";
      await updateInstallState(session.db, {
        step: report.step.id as "download" | "migrate" | "sites" | "admin",
        stepStatus: failed ? "failed" : report.outcome === "busy" ? "running" : "done",
        lastError: failed ? report.message : null,
      });
    }
    return {
      ok: true,
      report: {
        step: report.step,
        outcome: report.outcome,
        message: report.message,
        effects: report.effects,
        finished: report.finished,
        next: report.state.next,
      },
    };
  } catch (error) {
    return answer(error);
  }
}

/**
 * Recovery for an update whose new admin does not work: rolls the hub back to the release installed before it,
 * one step per request, as the admin's own Roll back does. The admin publishes every page again once it answers.
 */
export async function rollback(env: Env, input: StepRequest, clientIp: string): Promise<StepResponse> {
  try {
    const session = await openSession(env, { token: input.token, accountId: input.accountId, clientIp });
    if (input.next === 0) {
      const started = await beginRollback(session.ctx);
      if (!started.ok) return fail("release", started.message);
    }
    const report = await runReleaseStep(
      session.ctx,
      {
        token: input.token,
        release: (pin) => releaseFromUrl({ baseUrl: releaseBaseUrl(env, pin), pinnedSha256: pin.sha256 }),
      },
      { next: input.next },
    );
    return {
      ok: true,
      report: {
        step: report.step,
        outcome: report.outcome,
        message: report.message,
        effects: report.effects,
        finished: report.finished,
        next: report.state.next,
      },
    };
  } catch (error) {
    return answer(error);
  }
}

/** The end of an install, and recovery later: a new one-time setup link. Any earlier link stops working. */
export async function finish(env: Env, input: FinishRequest, clientIp: string): Promise<FinishResponse> {
  try {
    const session = await openSession(env, { token: input.token, accountId: input.accountId, clientIp });
    if ((await getWorkspace(session.db))?.installedRelease == null) {
      return fail("not-installed", "The admin panel is not installed yet. Finish the install first.");
    }
    const url = await adminUrl(session.ctx);
    if (url === null)
      return fail("cloudflare", "Your account has no workers.dev address, so the admin cannot be reached.");
    const secret = await issueSetupSecret(session.ctx);
    await updateInstallState(session.db, { step: "done", stepStatus: "done", lastError: null, finishedAt: Date.now() });
    return { ok: true, adminUrl: `${url}/admin`, setupUrl: `${url}/admin/setup?secret=${secret}` };
  } catch (error) {
    return answer(error);
  }
}

const STEP_TITLES: Record<string, string> = {
  download: "Download and check Deparked",
  migrate: "Prepare the database",
  sites: "Upload the pages Worker",
  admin: "Install the admin panel",
};

/** Where an earlier install stands. Only shown after the ownership proof. */
async function progress(db: Db): Promise<InstallProgress> {
  const [state, workspace] = await Promise.all([getInstallState(db), getWorkspace(db)]);
  const done = state?.step === "done";
  return {
    installedRelease: workspace?.installedRelease ?? null,
    startedAt: done ? null : (state?.startedAt ?? null),
    stoppedAt: done || state?.startedAt == null ? null : (STEP_TITLES[state.step] ?? null),
    lastError: done ? null : (state?.lastError ?? null),
  };
}

/** For anyone who opens the page: whether there is an install, nothing about it. Reads only. */
export async function status(env: Env): Promise<Status> {
  const base: Status = { phase: "fresh", pinnedRelease: releasePin(env)?.version ?? null };
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('install_state', 'workspace')",
  ).all();
  if (tables.results.length < 2) return base;
  const db = createDb(env.DB);
  const [state, workspace] = await Promise.all([getInstallState(db), getWorkspace(db)]);
  if (workspace?.installedRelease != null && state?.step === "done") return { ...base, phase: "installed" };
  return state?.startedAt == null ? base : { ...base, phase: "in-progress" };
}
