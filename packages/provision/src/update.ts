// Update and Rollback, run by the admin one step per request. Both install a release by its pin (version and the
// SHA-256 of its release.json) with the install's own steps; the pin of the running change lives in D1
// (`release_state`), so no step takes a version or a hash from the browser.
//
// Trust: an update installs only a pin the owner confirmed, and every file is checked against it. The checksum
// catches a download that was corrupted or altered on its way; it cannot tell a release published from a
// compromised repository. A rollback installs the pin that was installed before the last update.
//
// Schema: migrations only run forward. Each release names its schema (its last migration); a rollback is refused
// when the database has run a migration the older release does not know.

import {
  appliedSchema,
  getReleaseState,
  getWorkspace,
  listDeployments,
  type ReleaseState,
  updateReleaseState,
} from "@deparked/db";
import { compareVersions } from "@deparked/hosting";
import type { ProvisionContext } from "./context";
import { type HubOptions, releaseSteps } from "./hub";
import { ReleaseError, type ReleaseSource, VERSION } from "./release";
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

/** Whether the owner can roll back, and why not. */
export interface RollbackAvailability {
  possible: boolean;
  /** Plain words; empty when possible. */
  reason: string;
}

const SHA256 = /^[0-9a-f]{64}$/;

export function isPin(pin: ReleasePin): boolean {
  return pin.version.length <= 64 && VERSION.test(pin.version) && SHA256.test(pin.sha256);
}

/** True when `candidate` is a later version than `installed`, by semantic version precedence. */
export function isNewer(candidate: string, installed: string): boolean {
  return compareVersions(candidate, installed) > 0;
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

const samePin = (a: ReleasePin, b: ReleasePin) => a.version === b.version && a.sha256 === b.sha256;

/** The update or rollback last started, finished or not. */
export async function currentChange(ctx: Pick<ProvisionContext, "db">): Promise<ReleaseChange | null> {
  return changeOf(await getReleaseState(ctx.db));
}

const NO_PIN = (version: string) =>
  `Deparked ${version} was installed without a recorded checksum, so it cannot be installed again from here.`;
const NEWER_SCHEMA = (target: string, schema: string) =>
  `Your database was changed by a newer version (${schema}), and Deparked ${target} cannot run on it. Rolling back is not possible: install a newer release instead.`;

/** The pin a rollback would install (what was installed before the last update), and whether it can be. */
export async function rollbackTarget(
  ctx: Pick<ProvisionContext, "db">,
): Promise<(RollbackAvailability & { pin: ReleasePin }) | null> {
  const state = await getReleaseState(ctx.db);
  if (state?.previousVersion == null) return null;
  const pin = { version: state.previousVersion, sha256: state.previousSha256 ?? "" };
  if (state.previousSha256 == null || state.previousSchema == null) {
    return { pin, possible: false, reason: NO_PIN(pin.version) };
  }
  const schema = await appliedSchema(ctx.db);
  if (schema !== null && schema > state.previousSchema) {
    return { pin, possible: false, reason: NEWER_SCHEMA(pin.version, schema) };
  }
  return { pin, possible: true, reason: "" };
}

function verifyStep(source: ReleaseSource, pin: ReleasePin): Step {
  return {
    id: "download",
    title: "Download and check Deparked",
    async check(ctx) {
      const state = await getReleaseState(ctx.db);
      const change = changeOf(state);
      const verified = change !== null && samePin(change.pin, pin) && !change.finished && (state?.changeNext ?? 0) > 0;
      return verified
        ? { status: "done", effects: [] }
        : {
            status: "needed",
            effects: [{ kind: "reuse", what: `Deparked ${pin.version}, every file checked against its checksum` }],
          };
    },
    async run() {
      const release = await source.manifest();
      if (release.version !== pin.version) {
        throw new ReleaseError(`release.json says ${release.version}, but ${pin.version} was confirmed.`);
      }
      for (const pack of release.packs) await source.pack(pack.name);
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

async function installed(ctx: ProvisionContext) {
  const [workspace, state] = await Promise.all([getWorkspace(ctx.db), getReleaseState(ctx.db)]);
  return {
    version: workspace?.installedRelease ?? null,
    sha256: state?.installedSha256 ?? null,
    schema: state?.installedSchema ?? null,
  };
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
  const current = await installed(ctx);
  if (current.version === null) return "Deparked is not installed yet. Finish the install first.";
  if (!isNewer(pin.version, current.version)) {
    return `Deparked ${current.version} is installed: ${pin.version} is not newer. Going back is only possible with Roll back.`;
  }
  return null;
}

/**
 * What updating to `pin` would do, step by step, without changing anything, and whether it could be rolled back
 * afterwards. Checks release.json against the pin.
 */
export async function previewUpdate(
  ctx: ProvisionContext,
  options: UpdateOptions,
  pin: ReleasePin,
): Promise<{ ok: true; report: DryRunReport; rollback: RollbackAvailability } | { ok: false; message: string }> {
  const refusal = await updateRefusal(ctx, pin);
  if (refusal !== null) return { ok: false, message: refusal };
  const source = options.release(pin);
  const release = await source.manifest();
  if (release.version !== pin.version) {
    return { ok: false, message: `release.json says ${release.version}, but the release is ${pin.version}.` };
  }
  const current = await installed(ctx);
  const rollback: RollbackAvailability =
    current.sha256 === null || current.schema === null
      ? {
          possible: false,
          reason: `This update cannot be rolled back: the checksum of Deparked ${current.version} was not recorded when it was installed.`,
        }
      : release.schema > current.schema
        ? {
            possible: false,
            reason: `This update changes the database (up to ${release.schema}), so it cannot be rolled back: Deparked ${current.version} cannot run on the changed database.`,
          }
        : { possible: true, reason: "" };
  return {
    ok: true,
    report: await dryRun(planReleaseChange(ctx, options, { kind: "update", pin }, source)),
    rollback,
  };
}

/**
 * Starts the update to `pin`, which the owner confirmed. The installed pin becomes the rollback target. Starting
 * the same update again resumes it; any other while one is unfinished is refused.
 */
export function beginUpdate(ctx: ProvisionContext, pin: ReleasePin): Promise<BeginResult> {
  return locked(ctx, async () => {
    const change = await currentChange(ctx);
    if (change !== null && !change.finished) {
      if (change.kind === "update" && samePin(change.pin, pin)) return { ok: true, change };
      return {
        ok: false,
        message: `The ${change.kind} to ${change.pin.version} is not finished. Retry it, or roll back, first.`,
      };
    }
    const refusal = await updateRefusal(ctx, pin);
    if (refusal !== null) return { ok: false, message: refusal };
    const current = await installed(ctx);
    const startedAt = ctx.now();
    await updateReleaseState(ctx.db, {
      changeKind: "update",
      changeVersion: pin.version,
      changeSha256: pin.sha256,
      changeStartedAt: startedAt,
      changeNext: 0,
      changeFinishedAt: null,
      previousVersion: current.version,
      previousSha256: current.sha256,
      previousSchema: current.schema,
    });
    return { ok: true, change: { kind: "update", pin, startedAt, finished: false } };
  });
}

/**
 * Starts going back to the pin installed before the last update, also while that update is unfinished: the way
 * out of a broken one. The only way to install an older version, and refused when the database is newer than
 * that version supports.
 */
export function beginRollback(ctx: ProvisionContext): Promise<BeginResult> {
  return locked(ctx, async () => {
    const change = await currentChange(ctx);
    if (change?.kind === "rollback" && !change.finished) return { ok: true, change };
    const target = await rollbackTarget(ctx);
    if (target === null) return { ok: false, message: "There is no earlier version to go back to." };
    if (!target.possible) return { ok: false, message: target.reason };
    const startedAt = ctx.now();
    await updateReleaseState(ctx.db, {
      changeKind: "rollback",
      changeVersion: target.pin.version,
      changeSha256: target.pin.sha256,
      changeStartedAt: startedAt,
      changeNext: 0,
      changeFinishedAt: null,
      previousVersion: null,
      previousSha256: null,
      previousSchema: null,
    });
    return { ok: true, change: { kind: "rollback", pin: target.pin, startedAt, finished: false } };
  });
}

const NO_CHANGE = "No update is running. Start it again from Settings.";
const MOVED = "Another update or rollback was started in the meantime. Nothing was changed: reload the page.";

/**
 * Looks at step `state.next` of the running change, and runs it when needed. The order is the server's: the
 * database records how far the change got, and a step beyond that is refused, so a forged index cannot replace
 * the admin before the release is checked and the database migrated. Inside the lock the change is read again:
 * a plan made for an update that a rollback has since replaced runs nothing.
 */
export async function runReleaseStep(
  ctx: ProvisionContext,
  options: UpdateOptions,
  state: PlanState,
  /** The change the caller is driving: refused when the running change is another one. */
  expected?: { kind: ReleaseChangeKind; pin: ReleasePin },
): Promise<StepReport> {
  const stored = await getReleaseState(ctx.db);
  const change = changeOf(stored);
  if (change === null || change.finished) {
    return { step: null, outcome: "blocked", message: NO_CHANGE, effects: [], requests: 0, state, finished: false };
  }
  if (expected !== undefined && (expected.kind !== change.kind || !samePin(expected.pin, change.pin))) {
    return { step: null, outcome: "blocked", message: MOVED, effects: [], requests: 0, state, finished: false };
  }
  const plan = planReleaseChange(ctx, options, change);
  const index = Math.min(Math.max(0, Math.trunc(state.next)), plan.steps.length);
  const reached = stored?.changeNext ?? 0;
  if (index > reached) {
    const step = plan.steps[index];
    return {
      step: step === undefined ? null : { id: step.id, title: step.title, index, total: plan.steps.length },
      outcome: "blocked",
      message: `“${plan.steps[reached]?.title ?? "An earlier step"}” is not done yet. Start again from the first step.`,
      effects: [],
      requests: 0,
      state: { next: index },
      finished: false,
    };
  }
  return runNextStep(
    plan,
    { next: index },
    {
      guard: async () => {
        const now = changeOf(await getReleaseState(ctx.db));
        return now !== null && !now.finished && now.kind === change.kind && samePin(now.pin, change.pin) ? null : MOVED;
      },
      moved: async (next) => {
        if (next > ((await getReleaseState(ctx.db))?.changeNext ?? 0))
          await updateReleaseState(ctx.db, { changeNext: next });
      },
    },
  );
}

/** True once a "republish all" that started after `since` has gone live. */
async function republishedSince(ctx: ProvisionContext, since: number): Promise<boolean> {
  const done = await listDeployments(ctx.db, { worker: "sites", status: "done" });
  return done.some((row) => row.kind === "update" && row.host === null && row.startedAt >= since);
}

/**
 * Marks the running change finished once its admin is installed and every page was published again after the
 * new admin was uploaded, so by the new admin. The caller checks first that the new admin answers.
 */
export function finishReleaseChange(ctx: ProvisionContext): Promise<BeginResult> {
  return locked(ctx, async () => {
    const state = await getReleaseState(ctx.db);
    const change = changeOf(state);
    if (change === null) return { ok: false, message: NO_CHANGE };
    if (change.finished) return { ok: true, change };
    const current = await installed(ctx);
    const uploadedAt = state?.adminUploadedAt ?? null;
    if (
      current.version !== change.pin.version ||
      current.sha256 !== change.pin.sha256 ||
      uploadedAt === null ||
      uploadedAt < change.startedAt
    ) {
      return { ok: false, message: `Deparked ${change.pin.version} is not installed yet. Retry the ${change.kind}.` };
    }
    if (!(await republishedSince(ctx, uploadedAt))) {
      return { ok: false, message: `Every page has to be published again by Deparked ${change.pin.version} first.` };
    }
    await updateReleaseState(ctx.db, { changeFinishedAt: ctx.now() });
    return { ok: true, change: { ...change, finished: true } };
  });
}
