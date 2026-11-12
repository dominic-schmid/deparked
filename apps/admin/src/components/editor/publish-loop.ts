import type { StartResult, StepResult } from "../../server/publish/pipeline";

export type PublishOutcome =
  | { status: "done"; message: string }
  | {
      status: "failed";
      /** `network`: a request did not come back; `deploymentId` is then the publish to continue with Retry. */
      reason:
        | Exclude<StartResult, { ok: true }>["reason"]
        | Extract<StepResult, { status: "failed" }>["reason"]
        | "network";
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
  /** The loop stops after this many steps, as a guard against a publish that never ends. */
  maxSteps?: number;
};

const NETWORK =
  "The connection to the admin dropped. The publish may still be running: Retry continues it where it stopped.";

/**
 * Runs a publish to the end: one step request at a time, the next only after the previous one answered, as the
 * pipeline expects. Never throws; every way it can end is an outcome.
 */
export async function runPublish(deps: PublishDeps): Promise<PublishOutcome> {
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
  for (let count = 0; count < maxSteps; count += 1) {
    let result: StepResult;
    try {
      result = await deps.step(deploymentId);
    } catch {
      return { status: "failed", reason: "network", message: NETWORK, deploymentId };
    }
    deps.onStep(result);
    if (result.status === "done") return { status: "done", message: result.message };
    if (result.status === "failed") return { status: "failed", reason: result.reason, message: result.message };
  }
  return { status: "failed", reason: "network", message: NETWORK, deploymentId };
}

/** Polls until no publish holds the lock. Resolves false when `signal` aborts first. */
export async function waitUntilFree(deps: {
  read: () => Promise<{ holder: unknown }>;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
  intervalMs?: number;
}): Promise<boolean> {
  while (!deps.signal.aborted) {
    try {
      if ((await deps.read()).holder === null) return true;
    } catch {
      // A dropped poll is retried on the next round.
    }
    await deps.sleep(deps.intervalMs ?? 2000);
  }
  return false;
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
