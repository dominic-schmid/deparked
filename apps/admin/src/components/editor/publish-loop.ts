import type { StartResult, StepResult } from "../../server/publish/pipeline";

export type PublishOutcome =
  | { status: "done"; message: string }
  /** The page went away (`signal` aborted): nothing more is sent, the publish stops after the step in flight. */
  | { status: "stopped" }
  | {
      status: "failed";
      /**
       * `network`: a request did not come back; `deploymentId` is then the publish Retry continues.
       * `stalled`: steps kept answering without moving forward.
       */
      reason:
        | Exclude<StartResult, { ok: true }>["reason"]
        | Extract<StepResult, { status: "failed" }>["reason"]
        | "network"
        | "stalled";
      message: string;
      deploymentId?: number;
    };

export type PublishDeps = {
  /** Starts the publish (or a revert). Not called when `resume` is given. */
  start: () => Promise<StartResult>;
  step: (deploymentId: number) => Promise<StepResult>;
  /** Every answer of a step, for the progress line. */
  onStep: (result: StepResult) => void;
  /** Continues a publish that was started before, after the connection dropped. */
  resume?: number;
  signal?: AbortSignal;
  /** The loop stops after this many steps, as a guard against a publish that never ends. */
  maxSteps?: number;
};

/** Running steps in a row with exactly the same progress before the loop calls the publish stalled. */
export const STALL_STEPS = 5;

const NETWORK =
  "The connection to the admin dropped. The publish may still be running: Retry continues it where it stopped.";
const STALLED =
  "The publish stopped making progress, so it was not finished and nothing new went live. Try again in a few minutes.";

/**
 * Runs a publish to the end: one step request at a time, the next only after the previous one answered, as the
 * pipeline expects. Never throws; every way it can end is an outcome.
 */
export async function runPublish(deps: PublishDeps): Promise<PublishOutcome> {
  const stopped = () => deps.signal?.aborted === true;
  let deploymentId = deps.resume;
  if (deploymentId === undefined) {
    let started: StartResult;
    try {
      started = await deps.start();
    } catch {
      return {
        status: "failed",
        reason: "network",
        message: "The publish could not be started. Check the connection and try again.",
      };
    }
    if (!started.ok) {
      return {
        status: "failed",
        reason: started.reason,
        message: started.message,
        ...(started.deploymentId === undefined ? {} : { deploymentId: started.deploymentId }),
      };
    }
    deploymentId = started.deploymentId;
  }
  const maxSteps = deps.maxSteps ?? 200;
  let previous = "";
  let same = 0;
  for (let count = 0; count < maxSteps; count += 1) {
    if (stopped()) return { status: "stopped" };
    let result: StepResult;
    try {
      result = await deps.step(deploymentId);
    } catch {
      return stopped()
        ? { status: "stopped" }
        : { status: "failed", reason: "network", message: NETWORK, deploymentId };
    }
    if (stopped()) return { status: "stopped" };
    deps.onStep(result);
    if (result.status === "done") return { status: "done", message: result.message };
    if (result.status === "failed") return { status: "failed", reason: result.reason, message: result.message };
    const progress = JSON.stringify(result.progress);
    same = progress === previous ? same + 1 : 1;
    previous = progress;
    if (same >= STALL_STEPS) return { status: "failed", reason: "stalled", message: STALLED };
  }
  return { status: "failed", reason: "stalled", message: STALLED };
}

/** Failed polls in a row before `waitUntilFree` gives up (the session may have expired). */
export const MAX_FAILED_POLLS = 3;

/** Polls until no publish holds the lock. */
export async function waitUntilFree(deps: {
  read: () => Promise<{ holder: unknown }>;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
  intervalMs?: number;
}): Promise<"free" | "aborted" | "unreachable"> {
  let failures = 0;
  while (!deps.signal.aborted) {
    try {
      if ((await deps.read()).holder === null) return "free";
      failures = 0;
    } catch {
      failures += 1;
      if (failures >= MAX_FAILED_POLLS) return "unreachable";
    }
    await deps.sleep(deps.intervalMs ?? 2000);
  }
  return "aborted";
}

/**
 * Whether a revert's start answer means the draft was already replaced. `revertTo` takes the lock, then writes the
 * draft: a refusal before the lock (busy, invalid) leaves the owner's draft as it was; a failure after it does not.
 */
export function revertWroteDraft(result: StartResult): boolean {
  return result.ok || (result.reason !== "busy" && result.reason !== "invalid" && result.deploymentId !== undefined);
}

/** What the progress line says while a step runs. */
export function progressText(result: StepResult): string {
  const { pending, remainingHosts } = result.progress;
  const parts = [result.message];
  if (result.status === "running" && pending > 0) parts.push(`${pending} ${pending === 1 ? "file" : "files"} to go.`);
  if (result.status === "running" && remainingHosts > 0) {
    parts.push(`${remainingHosts} ${remainingHosts === 1 ? "domain" : "domains"} to go.`);
  }
  return parts.join(" ");
}
