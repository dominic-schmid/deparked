// Update and Rollback, run by the admin one step per request. Both install a release by its pin (version and the
// SHA-256 of its release.json) with the install's own steps; the pin of the running change lives in D1
// (`release_state`), so no step takes a version or a hash from the browser.
//
// Trust: the owner confirms the pin an update installs (the admin shows the version and the hash; nothing is ever
// installed without that confirmation). A rollback installs the pin that was installed before the last update.
// Migrations only run forward: a rollback keeps the database as the newer release left it.
import { getReleaseState, getWorkspace, type ReleaseState, updateReleaseState } from "@deparked/db";
import type { ProvisionContext } from "./context";
import { type HubOptions, releaseSteps } from "./hub";
import { ReleaseError, type ReleaseSource, VERSION, versionAtLeast } from "./release";
import {
  type DryRunReport,
  dryRun,
  type Plan,
  type PlanState,
  runNextStep,
  type Step,
  type StepReport,
  withProvisionLock,
} from "./steps";

export interface ReleasePin {
  version: string;
  sha256: string;
}

export type ReleaseChangeKind = "update" | "rollback";

export interface ReleaseChange {
  kind: ReleaseChangeKind;
  pin: ReleasePin;
  startedAt: number;
  finished: boolean;
}

export interface UpdateOptions {
  /** The stored API token: the admin keeps it as its `CF_API_TOKEN` secret. */
  token: string;
  /** Where a release is downloaded from. Every file is checked against the pin before it is used. */
  release: (pin: ReleasePin) => ReleaseSource;
  databaseName?: string;
}

export type BeginResult = { ok: true; change: ReleaseChange } | { ok: false; message: string };

const SHA256 = /^[0-9a-f]{64}$/;

export function isPin(pin: ReleasePin): boolean {
  return VERSION.test(pin.version) && SHA256.test(pin.sha256);
}

/** True when `candidate` is a later version than `installed` (`x.y.z`; a pre-release counts as its version). */
export function isNewer(candidate: string, installed: string): boolean {
  return !versionAtLeast(installed, candidate);
}

function changeOf(state: ReleaseState | undefined): ReleaseChange | null {
  if (state?.changeKind == null || state.changeVersion == null || state.changeSha256 == null) return null;
  return {
    kind: state.changeKind,
    pin: { version: state.changeVersion, sha256: state.changeSha256 },
    startedAt: state.changeStartedAt ?? 0,
    finished: state.changeFinishedAt != null,
  };
}

/** The update or rollback last started, finished or not. */
export async function currentChange(ctx: Pick<ProvisionContext, "db">): Promise<ReleaseChange | null> {
  return changeOf(await getReleaseState(ctx.db));
}

/** The pin a rollback would install: what was installed before the last update. */
export async function rollbackTarget(ctx: Pick<ProvisionContext, "db">): Promise<ReleasePin | null> {
  const state = await getReleaseState(ctx.db);
  return state?.previousVersion == null || state.previousSha256 == null
    ? null
    : { version: state.previousVersion, sha256: state.previousSha256 };
}

function verifyStep(source: ReleaseSource, pin: ReleasePin): Step {
  return {
    id: "download",
    title: "Download and check Deparked",
    async check(ctx) {
      const state = await getReleaseState(ctx.db);
      const change = changeOf(state);
      const verified =
        change !== null && change.pin.sha256 === pin.sha256 && !change.finished && state?.changeVerifiedAt != null;
      return verified
        ? { status: "done", effects: [] }
        : {
            status: "needed",
            effects: [{ kind: "reuse", what: `Deparked ${pin.version}, every file checked against its checksum` }],
          };
    },
    async run(ctx) {
      const release = await source.manifest();
      if (release.version !== pin.version) {
        throw new ReleaseError(`release.json says ${release.version}, but ${pin.version} was confirmed.`);
      }
      for (const pack of release.packs) await source.pack(pack.name);
      await updateReleaseState(ctx.db, { changeVerifiedAt: ctx.now() });
      return {
        effects: [{ kind: "reuse", what: `Deparked ${release.version}: ${release.files.length} files checked` }],
      };
    },
  };
}

/**
 * Download and check, migrate, upload the pages Worker, replace the admin: the install's steps for `pin`. The
 * browser republishes every page after the last one, from the new admin.
 */
export function planReleaseChange(
  ctx: ProvisionContext,
  options: UpdateOptions,
  change: { kind: ReleaseChangeKind; pin: ReleasePin },
  release: ReleaseSource = options.release(change.pin),
): Plan {
  const hub: HubOptions = {
    release,
    token: options.token,
    ...(options.databaseName === undefined ? {} : { databaseName: options.databaseName }),
  };
  return { kind: change.kind, host: null, ctx, steps: [verifyStep(release, change.pin), ...releaseSteps(hub)] };
}

async function installedPin(ctx: ProvisionContext): Promise<{ version: string | null; sha256: string | null }> {
  const [workspace, state] = await Promise.all([getWorkspace(ctx.db), getReleaseState(ctx.db)]);
  return { version: workspace?.installedRelease ?? null, sha256: state?.installedSha256 ?? null };
}

const locked = async (ctx: ProvisionContext, work: () => Promise<BeginResult>): Promise<BeginResult> => {
  const result = await withProvisionLock(ctx, work);
  return result.status === "ran"
    ? result.value
    : { ok: false, message: "Another change to Deparked is running. Try again in a moment." };
};

/** Why `pin` cannot be updated to, or null. A version that is not newer than the installed one is refused. */
async function updateRefusal(ctx: ProvisionContext, pin: ReleasePin): Promise<string | null> {
  if (!isPin(pin)) return "That is not a release version and checksum.";
  const installed = await installedPin(ctx);
  if (installed.version === null) return "Deparked is not installed yet. Finish the install first.";
  if (!isNewer(pin.version, installed.version)) {
    return `Deparked ${installed.version} is installed: ${pin.version} is not newer. Going back is only possible with Roll back.`;
  }
  return null;
}

/** What updating to `pin` would do, step by step, without changing anything. Checks release.json against the pin. */
export async function previewUpdate(
  ctx: ProvisionContext,
  options: UpdateOptions,
  pin: ReleasePin,
): Promise<{ ok: true; report: DryRunReport } | { ok: false; message: string }> {
  const refusal = await updateRefusal(ctx, pin);
  if (refusal !== null) return { ok: false, message: refusal };
  const source = options.release(pin);
  const release = await source.manifest();
  if (release.version !== pin.version) {
    return { ok: false, message: `release.json says ${release.version}, but the release is ${pin.version}.` };
  }
  return { ok: true, report: await dryRun(planReleaseChange(ctx, options, { kind: "update", pin }, source)) };
}

/**
 * Starts the update to `pin`, which the owner confirmed. The installed pin becomes the rollback target. Starting
 * the same update again resumes it; any other while one is unfinished is refused.
 */
export function beginUpdate(ctx: ProvisionContext, pin: ReleasePin): Promise<BeginResult> {
  return locked(ctx, async () => {
    const change = await currentChange(ctx);
    if (change !== null && !change.finished) {
      if (change.kind === "update" && change.pin.version === pin.version && change.pin.sha256 === pin.sha256) {
        return { ok: true, change };
      }
      return {
        ok: false,
        message: `The ${change.kind} to ${change.pin.version} is not finished. Retry it, or roll back, first.`,
      };
    }
    const refusal = await updateRefusal(ctx, pin);
    if (refusal !== null) return { ok: false, message: refusal };
    const installed = await installedPin(ctx);
    const startedAt = ctx.now();
    await updateReleaseState(ctx.db, {
      changeKind: "update",
      changeVersion: pin.version,
      changeSha256: pin.sha256,
      changeStartedAt: startedAt,
      changeVerifiedAt: null,
      changeFinishedAt: null,
      previousVersion: installed.sha256 === null ? null : installed.version,
      previousSha256: installed.sha256,
    });
    return { ok: true, change: { kind: "update", pin, startedAt, finished: false } };
  });
}

/**
 * Starts going back to the pin installed before the last update, also while that update is unfinished: the way
 * out of a broken one. The only way to install an older version.
 */
export function beginRollback(ctx: ProvisionContext): Promise<BeginResult> {
  return locked(ctx, async () => {
    const change = await currentChange(ctx);
    if (change?.kind === "rollback" && !change.finished) return { ok: true, change };
    const target = await rollbackTarget(ctx);
    if (target === null) return { ok: false, message: "There is no earlier version to go back to." };
    const startedAt = ctx.now();
    await updateReleaseState(ctx.db, {
      changeKind: "rollback",
      changeVersion: target.version,
      changeSha256: target.sha256,
      changeStartedAt: startedAt,
      changeVerifiedAt: null,
      changeFinishedAt: null,
      previousVersion: null,
      previousSha256: null,
    });
    return { ok: true, change: { kind: "rollback", pin: target, startedAt, finished: false } };
  });
}

const NO_CHANGE = "No update is running. Start it again from Settings.";

/**
 * Looks at step `state.next` of the running change, and runs it when needed. The order is the server's: a step
 * runs only once every step before it is done, so a forged index cannot replace the admin before the database
 * is migrated or the release is checked.
 */
export async function runReleaseStep(
  ctx: ProvisionContext,
  options: UpdateOptions,
  state: PlanState,
): Promise<StepReport> {
  const change = await currentChange(ctx);
  if (change === null || change.finished) {
    return { step: null, outcome: "blocked", message: NO_CHANGE, effects: [], requests: 0, state, finished: false };
  }
  const plan = planReleaseChange(ctx, options, change);
  const index = Math.min(Math.max(0, Math.trunc(state.next)), plan.steps.length);
  for (const earlier of plan.steps.slice(0, index)) {
    if ((await earlier.check(ctx)).status !== "done") {
      const step = plan.steps[index];
      return {
        step: step === undefined ? null : { id: step.id, title: step.title, index, total: plan.steps.length },
        outcome: "blocked",
        message: `“${earlier.title}” is not done yet. Start again from the first step.`,
        effects: [],
        requests: 0,
        state: { next: index },
        finished: false,
      };
    }
  }
  return runNextStep(plan, { next: index });
}

/**
 * Marks the running change finished once its admin is installed. The caller checks first that the new admin
 * answers and every page was published again.
 */
export function finishReleaseChange(ctx: ProvisionContext): Promise<BeginResult> {
  return locked(ctx, async () => {
    const change = await currentChange(ctx);
    if (change === null) return { ok: false, message: NO_CHANGE };
    if (change.finished) return { ok: true, change };
    const installed = await installedPin(ctx);
    if (installed.version !== change.pin.version || installed.sha256 !== change.pin.sha256) {
      return { ok: false, message: `Deparked ${change.pin.version} is not installed yet. Retry the ${change.kind}.` };
    }
    await updateReleaseState(ctx.db, { changeFinishedAt: ctx.now() });
    return { ok: true, change: { ...change, finished: true } };
  });
}
