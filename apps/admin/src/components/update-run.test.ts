import type { SetupStepReport } from "@deparked/hosting";
import { describe, expect, it } from "vitest";
import { type RunDeps, runChange } from "./update-run";

const TOTAL = 4;

function report(next: number, outcome: SetupStepReport["outcome"] = "ran"): SetupStepReport {
  const moved = outcome === "ran" || outcome === "already-done";
  const state = { next: moved ? next + 1 : next };
  return {
    step: { id: `s${next}`, title: `Step ${next}`, index: next, total: TOTAL },
    outcome,
    message: outcome === "failed" ? "Cloudflare said no" : "",
    effects: [],
    state,
    finished: state.next === TOTAL,
    credentialsRejected: false,
  };
}

function deps(overrides: Partial<RunDeps> = {}) {
  const calls: string[] = [];
  const base: RunDeps = {
    target: "1.1.0",
    running: "1.0.0",
    step: async (state) => {
      calls.push(`step ${state.next}`);
      return { ok: true, value: report(state.next) };
    },
    health: async () => {
      calls.push("health");
      return { release: "1.1.0" };
    },
    republish: async () => {
      calls.push("republish");
      return { status: "done", message: "" };
    },
    finish: async () => {
      calls.push("finish");
      return {
        ok: true,
        value: {
          ok: true,
          change: { kind: "update", pin: { version: "1.1.0", sha256: "" }, startedAt: 0, finished: true },
        },
      };
    },
    onEvent: () => {},
    sleep: async () => {},
    signal: new AbortController().signal,
    ...overrides,
  };
  return { deps: base, calls };
}

describe("running an update from the page", () => {
  it("runs the steps in order, then hands over to the new admin with a reload", async () => {
    const { deps: d, calls } = deps();
    expect(await runChange(d)).toEqual({ status: "reloading" });
    expect(calls).toEqual(["step 0", "step 1", "step 2", "step 3", "health"]);
  });

  it("served by the new admin, publishes every page again and finishes", async () => {
    const { deps: d, calls } = deps({ running: "1.1.0" });
    expect(await runChange(d)).toEqual({ status: "done" });
    expect(calls).toEqual(["step 0", "step 1", "step 2", "step 3", "republish", "finish"]);
  });

  it("waits while the old admin still answers", async () => {
    let polls = 0;
    const { deps: d } = deps({
      health: async () => {
        polls += 1;
        return { release: polls < 3 ? "1.0.0" : "1.1.0" };
      },
    });
    expect(await runChange(d)).toEqual({ status: "reloading" });
    expect(polls).toBe(3);
  });

  it("offers Roll back when the new admin never answers", async () => {
    const { deps: d, calls } = deps({ health: async () => null, handoverMs: 0 });
    expect(await runChange(d)).toMatchObject({ status: "failed", at: "handover", unhealthy: true });
    expect(calls).not.toContain("republish");
  });

  it("stops at a failed step and says where; nothing after it runs", async () => {
    const { deps: d, calls } = deps({
      step: async (state) => {
        calls.push(`step ${state.next}`);
        return { ok: true, value: report(state.next, state.next === 2 ? "failed" : "ran") };
      },
    });
    expect(await runChange(d)).toMatchObject({ status: "failed", at: 2, message: "Cloudflare said no" });
    expect(calls).toEqual(["step 0", "step 1", "step 2"]);
  });

  it("waits for another change, and a dropped connection is a failure Retry can repeat", async () => {
    let busy = 2;
    const { deps: d } = deps({
      running: "1.1.0",
      step: async (state) => ({ ok: true, value: report(state.next, busy-- > 0 ? "busy" : "ran") }),
    });
    expect(await runChange(d)).toEqual({ status: "done" });
    const { deps: dropped } = deps({
      step: async () => {
        throw new TypeError("network");
      },
    });
    expect(await runChange(dropped)).toMatchObject({ status: "failed", at: 0 });
  });

  it("reports a refused finish in plain words", async () => {
    const { deps: d } = deps({
      running: "1.1.0",
      finish: async () => ({ ok: true, value: { ok: false, message: "Every page has to be published again first." } }),
    });
    expect(await runChange(d)).toMatchObject({
      status: "failed",
      at: "finish",
      message: expect.stringContaining("published again"),
    });
  });
});
