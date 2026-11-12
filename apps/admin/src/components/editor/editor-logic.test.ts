import { CONFIG_VERSION, defaultConfig, parseConfig } from "@deparked/config";
import { describe, expect, it } from "vitest";
import type { StartResult, StepResult } from "../../server/publish/pipeline";
import { changedFields, configKey, errorsByField, fromForm, toForm } from "./form";
import { progressText, runPublish, waitUntilFree } from "./publish-loop";

const COLORS = { color: "#7f9fbf", contrast: "#ffffff" };
const PROGRESS = { uploaded: 0, pending: 0, remainingHosts: 0, requests: 0 };

describe("the editor form", () => {
  it("round-trips a config without changing it", () => {
    const config = { ...defaultConfig(), marketplaceUrl: "https://example.net/listing" };
    const parsed = parseConfig(fromForm(toForm(config, COLORS), CONFIG_VERSION));
    expect(parsed).toEqual({ ok: true, config });
  });

  it("reads thousands separators in the minimum offer and leaves other text to the schema", () => {
    const form = toForm(defaultConfig(), COLORS);
    expect(fromForm({ ...form, minOffer: "25,000" }, 1).minOffer).toBe(25_000);
    expect(fromForm({ ...form, minOffer: " 25 000 " }, 1).minOffer).toBe(25_000);
    expect(fromForm({ ...form, minOffer: "" }, 1).minOffer).toBeUndefined();
    const decimal = parseConfig(fromForm({ ...form, minOffer: "12.5" }, 1));
    expect(decimal.ok ? null : errorsByField(decimal.errors).minOffer).toBe(
      "Enter the minimum offer as a whole number, like 1000.",
    );
  });

  it("sends colours only when the override is on", () => {
    const form = toForm(defaultConfig(), COLORS);
    expect(form.accentOn).toBe(false);
    expect(fromForm(form, 1)).not.toHaveProperty("accent");
    const on = parseConfig(fromForm({ ...form, accentOn: true, accentPrimary: "#AA0000" }, 1));
    expect(on.ok && on.config.accent).toEqual({ primary: "#aa0000", contrast: "#ffffff" });
  });

  it("puts each schema error on the input it belongs to", () => {
    expect(
      errorsByField({
        "seo.title": "Add a page title.",
        "accent.contrast": "Use a six-digit hex colour, like #7f9fbf.",
        headline: "Add a headline.",
        version: "Reload.",
      }),
    ).toEqual({
      seoTitle: "Add a page title.",
      accentContrast: "Use a six-digit hex colour, like #7f9fbf.",
      headline: "Add a headline.",
      form: "Reload.",
    });
  });

  it("names what Publish would change", () => {
    const live = defaultConfig();
    expect(changedFields(live, live)).toEqual([]);
    expect(changedFields({ ...live, headline: "New", minOffer: 5 }, live)).toEqual(["Headline", "Minimum offer"]);
    expect(changedFields(live, null)).toHaveLength(11);
    expect(configKey(live)).toBe(configKey(structuredClone(live)));
  });
});

describe("runPublish", () => {
  const running = (pending: number): StepResult => ({
    status: "running",
    progress: { ...PROGRESS, pending },
    message: "Uploading.",
  });
  const done: StepResult = { status: "done", progress: PROGRESS, message: "Published.", versionId: "v1" };

  function fake(steps: (StepResult | Error)[], started: StartResult = { ok: true, deploymentId: 7 }) {
    const calls: string[] = [];
    let inFlight = 0;
    return {
      calls,
      deps: {
        start: async () => {
          calls.push("start");
          return started;
        },
        step: async (id: number) => {
          inFlight += 1;
          if (inFlight > 1) throw new Error("two steps at once");
          calls.push(`step ${id}`);
          await Promise.resolve();
          inFlight -= 1;
          const next = steps.shift();
          if (next === undefined) throw new Error("no more steps");
          if (next instanceof Error) throw next;
          return next;
        },
        onStep: (result: StepResult) => calls.push(`seen ${result.status}`),
      },
    };
  }

  it("steps one request at a time until the publish is done", async () => {
    const { calls, deps } = fake([running(3), running(1), done]);
    expect(await runPublish(deps)).toEqual({ status: "done", message: "Published." });
    expect(calls).toEqual(["start", "step 7", "seen running", "step 7", "seen running", "step 7", "seen done"]);
  });

  it("reports a refused start with its reason and who holds the lock", async () => {
    const { calls, deps } = fake([], {
      ok: false,
      reason: "busy",
      message: "Another publish is running.",
      deploymentId: 3,
    });
    expect(await runPublish(deps)).toEqual({
      status: "failed",
      reason: "busy",
      message: "Another publish is running.",
      deploymentId: 3,
    });
    expect(calls).toEqual(["start"]);
  });

  it("stops on a failed step and passes its words on", async () => {
    const failed: StepResult = {
      status: "failed",
      reason: "credentials-rejected",
      progress: PROGRESS,
      message: "Cloudflare rejected the token.",
    };
    const { deps } = fake([running(2), failed]);
    expect(await runPublish(deps)).toEqual({
      status: "failed",
      reason: "credentials-rejected",
      message: "Cloudflare rejected the token.",
    });
  });

  it("keeps the deployment when the connection drops, and Retry continues it without starting again", async () => {
    const { calls, deps } = fake([running(2), new Error("offline"), done]);
    const dropped = await runPublish(deps);
    expect(dropped).toMatchObject({ status: "failed", reason: "network", deploymentId: 7 });
    expect(await runPublish({ ...deps, resume: 7 })).toEqual({ status: "done", message: "Published." });
    expect(calls.filter((call) => call === "start")).toHaveLength(1);
  });

  it("gives up after the step limit", async () => {
    const { deps } = fake([running(1), running(1), running(1)]);
    expect(await runPublish({ ...deps, maxSteps: 2 })).toMatchObject({ status: "failed", reason: "network" });
  });

  it("describes the progress in words", () => {
    expect(progressText(running(1))).toBe("Uploading. 1 file to go.");
    expect(progressText(running(0))).toBe("Uploading.");
    expect(progressText(done)).toBe("Published.");
  });
});

describe("waitUntilFree", () => {
  it("polls until the lock is free, skipping a dropped poll", async () => {
    const answers: ({ holder: unknown } | Error)[] = [{ holder: { id: 1 } }, new Error("offline"), { holder: null }];
    const sleeps: number[] = [];
    const free = await waitUntilFree({
      read: async () => {
        const next = answers.shift();
        if (next instanceof Error || next === undefined) throw next ?? new Error("done");
        return next;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      signal: new AbortController().signal,
    });
    expect(free).toBe(true);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await waitUntilFree({ read: async () => ({ holder: 1 }), sleep: async () => {}, signal: controller.signal }),
    ).toBe(false);
  });
});
