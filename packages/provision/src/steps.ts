import { CloudflareApiError } from "@deparked/cf";
import { acquireProvisionLock, releaseProvisionLock } from "@deparked/db";
import type { ProvisionContext } from "./context";

/** One thing a step does or would do, in words the owner can read. `reuse` changes nothing. */
export interface Effect {
  kind: "create" | "change" | "remove" | "restore" | "reuse";
  what: string;
}

export type StepCheck =
  /** Nothing to do. `effects` only lists what is reused. */
  | { status: "done"; effects: Effect[] }
  /** `run` has work. `effects` is what it would create, change, remove, restore or reuse. */
  | { status: "needed"; effects: Effect[] }
  /** `run` must not be called: the owner has to do or confirm something first. */
  | { status: "blocked"; reason: string };

export interface StepResult {
  effects: Effect[];
  /** Set by the last step of an attach: the caller publishes the placeholder page next. */
  next?: "publish-placeholder";
}

/**
 * One idempotent piece of setup. `check` only reads. `run` creates what is missing and nothing else, so running
 * it twice changes nothing; each step stays far below the 50 subrequests of one Worker request on the free plan.
 */
export interface Step {
  id: string;
  /** Plain words for the progress list. */
  title: string;
  check(ctx: ProvisionContext): Promise<StepCheck>;
  run(ctx: ProvisionContext): Promise<StepResult>;
}

export interface Plan {
  kind: "attach" | "turn-off" | "remove" | "install" | "uninstall" | "update" | "rollback";
  /** Null for a plan of the whole hub (install, uninstall). */
  host: string | null;
  ctx: ProvisionContext;
  steps: readonly Step[];
}

/** Where a plan stands. The browser keeps it between requests and sends it back. */
export interface PlanState {
  /** Index of the step the next call looks at. */
  next: number;
}

export const PLAN_START: PlanState = { next: 0 };

export interface StepReport {
  /** Null when the plan had already finished. */
  step: { id: string; title: string; index: number; total: number } | null;
  /**
   * `ran`: the step did its work. `already-done`: nothing was needed. `blocked`: the owner must act; the state
   * did not move. `failed`: Cloudflare refused a call; call again with the same state to retry. `busy`:
   * another attach or turn off of this install is running a step; nothing was looked at, try again shortly.
   * `finished`: no step was left.
   */
  outcome: "ran" | "already-done" | "blocked" | "failed" | "busy" | "finished";
  /** The blocker or the error. Empty otherwise. */
  message: string;
  effects: Effect[];
  /** Cloudflare API requests this call made, retries included. */
  requests: number;
  /** Pass this to the next call. */
  state: PlanState;
  finished: boolean;
  next?: "publish-placeholder";
  /** `failed` only: the HTTP status of the Cloudflare error that failed the step (0 when no answer came). */
  errorStatus?: number;
}

/**
 * Thrown by a `run` that finds, right before it would change something, that the owner has to act first. It
 * becomes a `blocked` report, like a blocked `check`.
 */
export class StepBlockedError extends Error {
  override readonly name = "StepBlockedError";
}

/**
 * A failure that is not Cloudflare's but should reach the owner as a `failed` report with its message (a release
 * file that does not match its checksum). Retrying repeats the step.
 */
export class StepFailedError extends Error {
  override readonly name: string = "StepFailedError";
}

/** How long a step may hold the provisioning lock. A step makes at most a few dozen requests. */
export const PROVISION_LOCK_TTL_MS = 120_000;

export const BUSY_MESSAGE = "Another change to your domains is running. Try again in a moment.";

/**
 * Runs `work` while holding the install's provisioning lock, so that no two changes to Cloudflare made by
 * provisioning interleave (two attaches picking the same new bot check, two writes of one hostname list).
 * `busy` when another caller holds it: nothing ran. The lock expires after `PROVISION_LOCK_TTL_MS`, so a
 * crashed holder blocks nobody for long. `runNextStep` takes it for every step; call this directly only for
 * other provisioning changes.
 */
export async function withProvisionLock<T>(
  ctx: ProvisionContext,
  work: () => Promise<T>,
): Promise<{ status: "ran"; value: T } | { status: "busy" }> {
  const holder = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  if (!(await acquireProvisionLock(ctx.db, { holder, ttlMs: PROVISION_LOCK_TTL_MS, now: ctx.now() }))) {
    return { status: "busy" };
  }
  try {
    return { status: "ran", value: await work() };
  } finally {
    await releaseProvisionLock(ctx.db, holder);
  }
}

/**
 * Looks at exactly one step: runs it when it is needed, skips it when it is done. The browser calls this once
 * per request until `finished`, which keeps every request inside the free plan's limits and makes Retry a
 * repeat of the same call. Only a Cloudflare API failure becomes `failed`; any other error is thrown. The step
 * runs under the provisioning lock (`withProvisionLock`): while another step holds it the answer is `busy`.
 */
export async function runNextStep(plan: Plan, state: PlanState = PLAN_START): Promise<StepReport> {
  const total = plan.steps.length;
  if (!Number.isInteger(state.next) || state.next < 0 || state.next > total) {
    throw new RangeError(`This plan has no step ${state.next}`);
  }
  const step = plan.steps[state.next];
  if (step === undefined) {
    return { step: null, outcome: "finished", message: "", effects: [], requests: 0, state, finished: true };
  }

  const before = plan.ctx.cf.requestCount;
  const report = (
    outcome: StepReport["outcome"],
    fields: { message?: string; effects?: Effect[]; next?: "publish-placeholder"; errorStatus?: number } = {},
  ): StepReport => {
    const moved = outcome === "ran" || outcome === "already-done";
    const nextState = moved ? { next: state.next + 1 } : state;
    return {
      step: { id: step.id, title: step.title, index: state.next, total },
      outcome,
      message: fields.message ?? "",
      effects: fields.effects ?? [],
      requests: plan.ctx.cf.requestCount - before,
      state: nextState,
      finished: nextState.next === total,
      ...(fields.next === undefined ? {} : { next: fields.next }),
      ...(fields.errorStatus === undefined ? {} : { errorStatus: fields.errorStatus }),
    };
  };

  const locked = await withProvisionLock(plan.ctx, async () => {
    try {
      const check = await step.check(plan.ctx);
      if (check.status === "blocked") return report("blocked", { message: check.reason });
      if (check.status === "done") return report("already-done", { effects: check.effects });
      const result = await step.run(plan.ctx);
      return report("ran", result);
    } catch (error) {
      if (error instanceof StepBlockedError) return report("blocked", { message: error.message });
      if (error instanceof CloudflareApiError) {
        return report("failed", { message: error.message, errorStatus: error.status });
      }
      if (error instanceof StepFailedError) return report("failed", { message: error.message });
      throw error;
    }
  });
  return locked.status === "ran" ? locked.value : report("busy", { message: BUSY_MESSAGE });
}

export interface DryRunReport {
  kind: Plan["kind"];
  host: string | null;
  steps: ({ id: string; title: string } & StepCheck)[];
  /** True when every step is done: a second run right after a finished one must say this. */
  nothingToDo: boolean;
  blocked: boolean;
  /** Cloudflare API requests the dry run made. It only reads. */
  requests: number;
}

/** What each step would create, change or reuse, without changing anything. */
export async function dryRun(plan: Plan): Promise<DryRunReport> {
  const before = plan.ctx.cf.requestCount;
  const steps: DryRunReport["steps"] = [];
  for (const step of plan.steps) {
    steps.push({ id: step.id, title: step.title, ...(await step.check(plan.ctx)) });
  }
  return {
    kind: plan.kind,
    host: plan.host,
    steps,
    nothingToDo: steps.every((step) => step.status === "done"),
    blocked: steps.some((step) => step.status === "blocked"),
    requests: plan.ctx.cf.requestCount - before,
  };
}
