import {
  CloudflareApiError,
  type CloudflareClient,
  createCloudflareClient,
  PROBE_PERMISSION_LABELS,
  TOKEN_PERMISSIONS,
} from "@deparked/cf";
import {
  applyMigrations,
  createDb,
  type Db,
  d1Runner,
  getInstallState,
  getWorkspace,
  initInstallState,
  updateInstallState,
} from "@deparked/db";
import {
  adminUrl,
  DATABASE_NAME,
  dryRun,
  issueSetupSecret,
  type Plan,
  type ProvisionContext,
  planInstallHub,
  ReleaseError,
  releaseFromUrl,
  runNextStep,
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
  PermissionGap,
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

/** The install's own tables, through the binding: the ownership value lives in `install_state`. */
async function prepareDatabase(env: Env): Promise<Db> {
  await applyMigrations(d1Runner(env.DB));
  const db = createDb(env.DB);
  await initInstallState(db);
  return db;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

const FOREIGN_ACCOUNT =
  "This token works, but for another Cloudflare account than the one this installer runs in. Log in to the account you deployed the installer to, create the token there, then paste it here.";

/**
 * The proof that the person holding the token owns this installer: a value the installer wrote to its own
 * database through the binding must come back when read through the API with the token. A token of another
 * account cannot read it. `rotate` writes a new value first (the connect screen); a step reuses the current one.
 */
async function proveOwnership(db: Db, cf: CloudflareClient, rotate: boolean): Promise<void> {
  let nonce = (await getInstallState(db))?.ownershipNonce ?? null;
  if (rotate || nonce === null) {
    nonce = randomHex(24);
    await updateInstallState(db, { ownershipNonce: nonce, nonceCreatedAt: Date.now() });
  }
  const [database] = await cf.d1.list({ name: DATABASE_NAME });
  if (database === undefined) throw new Refusal("foreign-account", FOREIGN_ACCOUNT);
  const [result] = await cf.d1.query(database.uuid, "SELECT ownership_nonce FROM install_state WHERE id = 1");
  if (result?.results[0]?.ownership_nonce !== nonce) throw new Refusal("foreign-account", FOREIGN_ACCOUNT);
}

function gap(label: string): PermissionGap {
  const permission = TOKEN_PERMISSIONS.find((entry) => entry.label === label);
  return { label, why: permission?.why ?? "", scope: permission?.scope ?? "account" };
}

async function checkPermissions(
  cf: CloudflareClient,
): Promise<{ missing: PermissionGap[]; unchecked: PermissionGap[] }> {
  let zoneId: string | undefined;
  try {
    zoneId = (await cf.zones.list({}, { perPage: 5, maxPages: 1 }))[0]?.id;
  } catch (error) {
    if (!(error instanceof CloudflareApiError && error.status === 403)) throw error;
  }
  const report = await cf.tokens.probePermissions(zoneId === undefined ? {} : { zoneId });
  const label = (probe: string) => PROBE_PERMISSION_LABELS[probe] ?? probe;
  const missing = report.missing.map(label);
  // A probe that answered 404 (a zone without rules yet) proves nothing either way; without a zone the zone
  // permissions cannot be tried at all.
  const zoneLabels = TOKEN_PERMISSIONS.filter((entry) => entry.scope === "zone" && entry.label !== "Zone").map(
    (entry) => entry.label,
  );
  const unchecked = zoneId === undefined ? zoneLabels : report.unknown.map(label);
  return {
    missing: missing.map(gap),
    unchecked: unchecked.filter((entry) => !missing.includes(entry)).map(gap),
  };
}

interface Session {
  db: Db;
  cf: CloudflareClient;
  ctx: ProvisionContext;
  plan: Plan;
}

async function openSession(env: Env, token: string, accountId: string, rotate: boolean): Promise<Session> {
  const pin = releasePin(env);
  if (pin === null) throw new Refusal("no-release", NO_RELEASE);
  const cf = client(env, token, accountId);
  const db = await prepareDatabase(env);
  try {
    await proveOwnership(db, cf, rotate);
  } catch (error) {
    if (refusedToken(error)) throw new Refusal("invalid-token", INVALID_TOKEN);
    throw error;
  }
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
  return { db, cf, ctx, plan: planInstallHub(ctx, { release, token }) };
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

export async function check(env: Env, input: CheckRequest): Promise<CheckResponse> {
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
    const permissions = await checkPermissions(cf);
    if (permissions.missing.some((entry) => entry.label === "D1" || entry.label === "Workers Scripts")) {
      return { ok: true, status: "ready", account, release: "", ...permissions, steps: [], nothingToDo: false };
    }
    const session = await openSession(env, input.token, account.id, true);
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
    };
  } catch (error) {
    return answer(error);
  }
}

export async function step(env: Env, input: StepRequest): Promise<StepResponse> {
  try {
    const session = await openSession(env, input.token, input.accountId, false);
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

/** The end of an install, and recovery later: a new one-time setup link. Any earlier link stops working. */
export async function finish(env: Env, input: FinishRequest): Promise<FinishResponse> {
  try {
    const session = await openSession(env, input.token, input.accountId, false);
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

/** The installer's own address `deparked-install.<account>.workers.dev` names the admin's. */
function adminUrlFromHost(host: string): string | null {
  const labels = host.split(".");
  if (labels.length !== 4 || labels[2] !== "workers" || labels[3] !== "dev") return null;
  return `https://deparked-admin.${labels[1]}.workers.dev/admin`;
}

const STEP_TITLES: Record<string, string> = {
  download: "Download and check Deparked",
  migrate: "Prepare the database",
  sites: "Upload the pages Worker",
  admin: "Install the admin panel",
};

export async function status(env: Env, host: string): Promise<Status> {
  const pinned = releasePin(env)?.version ?? null;
  const base: Status = {
    phase: "fresh",
    pinnedRelease: pinned,
    installedRelease: null,
    adminUrl: adminUrlFromHost(host),
    startedAt: null,
    stoppedAt: null,
    lastError: null,
  };
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('install_state', 'workspace')",
  ).all();
  if (tables.results.length < 2) return base;
  const db = createDb(env.DB);
  const [state, workspace] = await Promise.all([getInstallState(db), getWorkspace(db)]);
  const installed = workspace?.installedRelease ?? null;
  if (installed !== null && state?.step === "done") return { ...base, phase: "installed", installedRelease: installed };
  if (state?.startedAt == null) return { ...base, installedRelease: installed };
  return {
    ...base,
    phase: "in-progress",
    installedRelease: installed,
    startedAt: state.startedAt,
    stoppedAt: STEP_TITLES[state.step] ?? null,
    lastError: state.lastError,
  };
}
