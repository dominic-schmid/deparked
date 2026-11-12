import type { ReleaseChangeResult, SetupState, SetupStepReport } from "@deparked/hosting";
import type { PublishOutcome } from "./editor/publish-loop";

/** A server function's answer: the value, or why the host refused. */
export type Answer<T> = { ok: true; value: T } | { ok: false; credentialsRejected: boolean; message: string };

/** Where a change stands, after the release steps: wait for the new admin, publish every page, finish. */
export type Stage = "handover" | "republish" | "finish";

export type RunEvent =
  | { type: "step"; report: SetupStepReport }
  | { type: "step-start"; index: number; waiting: boolean }
  | { type: "stage"; stage: Stage; status: "running" | "done" };

export type RunOutcome =
  | { status: "done" }
  /** The new admin answers: the page reloads so that its code drives what is left. */
  | { status: "reloading" }
  | { status: "stopped" }
  | {
      status: "failed";
      /** Where it stopped: a step index, or a stage. */
      at: number | Stage;
      message: string;
      credentialsRejected: boolean;
      /** The new admin did not take over: the way out is Roll back. */
      unhealthy?: boolean;
    };

export type RunDeps = {
  /** The version being installed. */
  target: string;
  /** The release the admin that served this page runs (null for a build not installed from a release). */
  running: string | null;
  step: (state: SetupState) => Promise<Answer<SetupStepReport>>;
  /** GET /api/health: null when it did not answer with a health report. */
  health: () => Promise<{ release: string | null } | null>;
  republish: () => Promise<PublishOutcome>;
  finish: () => Promise<Answer<ReleaseChangeResult>>;
  onEvent: (event: RunEvent) => void;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
  /** How long the new admin may take to answer. */
  handoverMs?: number;
};

const NO_ANSWER = "The admin did not answer. Nothing is lost: Retry continues where it stopped.";
const BUSY_TRIES = 30;
export const HANDOVER_MS = 90_000;
const POLL_MS = 1_500;

function unhealthy(target: string): RunOutcome {
  return {
    status: "failed",
    at: "handover",
    unhealthy: true,
    credentialsRejected: false,
    message: `Deparked ${target} was installed but does not answer. Roll back to the version you had; your pages stay online either way.`,
  };
}

/**
 * Drives an update or rollback to its end: every release step (one request each, the server keeps the order),
 * then waits until the new admin answers, then publishes every page again from it and finishes. Called again
 * after a failure (Retry) or a reload, it starts over: done steps answer "already done" at once. Never throws.
 */
export async function runChange(deps: RunDeps): Promise<RunOutcome> {
  const stopped = () => deps.signal.aborted;
  let state: SetupState = { next: 0 };
  let busy = 0;
  for (;;) {
    if (stopped()) return { status: "stopped" };
    deps.onEvent({ type: "step-start", index: state.next, waiting: busy > 0 });
    let answer: Answer<SetupStepReport>;
    try {
      answer = await deps.step(state);
    } catch {
      return { status: "failed", at: state.next, message: NO_ANSWER, credentialsRejected: false };
    }
    if (!answer.ok) {
      return {
        status: "failed",
        at: state.next,
        message: answer.message,
        credentialsRejected: answer.credentialsRejected,
      };
    }
    const report = answer.value;
    if (report.outcome === "busy" && busy < BUSY_TRIES) {
      busy += 1;
      await deps.sleep(2_000);
      continue;
    }
    busy = 0;
    deps.onEvent({ type: "step", report });
    if (report.outcome === "failed" || report.outcome === "blocked" || report.outcome === "busy") {
      return {
        status: "failed",
        at: state.next,
        message: report.message,
        credentialsRejected: report.credentialsRejected,
      };
    }
    state = report.state;
    if (report.finished || report.outcome === "finished") break;
  }

  if (deps.running !== deps.target) {
    deps.onEvent({ type: "stage", stage: "handover", status: "running" });
    const deadline = Date.now() + (deps.handoverMs ?? HANDOVER_MS);
    for (;;) {
      if (stopped()) return { status: "stopped" };
      const health = await deps.health().catch(() => null);
      if (health?.release === deps.target) return { status: "reloading" };
      // A build without a release (local development) cannot say which version it is: go on with it.
      if (health !== null && health.release === null) break;
      if (Date.now() >= deadline) return unhealthy(deps.target);
      await deps.sleep(POLL_MS);
    }
  }
  deps.onEvent({ type: "stage", stage: "handover", status: "done" });

  deps.onEvent({ type: "stage", stage: "republish", status: "running" });
  const published = await deps.republish();
  if (published.status === "stopped") return { status: "stopped" };
  if (published.status === "failed") {
    return {
      status: "failed",
      at: "republish",
      message: published.message,
      credentialsRejected: published.reason === "credentials-rejected",
    };
  }
  deps.onEvent({ type: "stage", stage: "republish", status: "done" });

  deps.onEvent({ type: "stage", stage: "finish", status: "running" });
  let finished: Answer<ReleaseChangeResult>;
  try {
    finished = await deps.finish();
  } catch {
    return { status: "failed", at: "finish", message: NO_ANSWER, credentialsRejected: false };
  }
  if (!finished.ok || !finished.value.ok) {
    const message = finished.ok ? (finished.value.ok ? "" : finished.value.message) : finished.message;
    return {
      status: "failed",
      at: "finish",
      message,
      credentialsRejected: !finished.ok && finished.credentialsRejected,
    };
  }
  deps.onEvent({ type: "stage", stage: "finish", status: "done" });
  return { status: "done" };
}
