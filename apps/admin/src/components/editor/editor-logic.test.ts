import { CONFIG_VERSION, defaultConfig, parseConfig } from "@deparked/config";
import { describe, expect, it } from "vitest";
import type { StartResult, StepResult } from "../../server/publish/pipeline";
import {
  backgroundForVariant,
  changedFields,
  configKey,
  describeChanges,
  errorsByField,
  fieldOf,
  fromForm,
  normalize,
  readAmount,
  toForm,
  truncate,
} from "./form";
import { inertPreview, PREVIEW_LINK_HINT } from "./preview-html";
import { progressText, revertWroteDraft, runPublish, STALL_STEPS, waitUntilFree } from "./publish-loop";

const COLORS = { color: "#7f9fbf", contrast: "#ffffff" };
const PROGRESS = { uploaded: 0, pending: 0, remainingHosts: 0, requests: 0 };

describe("the editor form", () => {
  it("swaps the background for one the picked variant draws, and keeps it for a variant that draws none", () => {
    const backgrounds = [
      { id: "sky", kind: "image" as const, label: "Sky", swatch: "" },
      { id: "dawn", kind: "gradient" as const, label: "Dawn", swatch: "" },
      { id: "tide", kind: "gradient" as const, label: "Tide", swatch: "" },
    ];
    const gradient = { kind: "gradient" as const, fallback: "dawn" };
    const photo = { kind: "image" as const, fallback: "sky" };
    expect(backgroundForVariant("sky", backgrounds, gradient)).toBe("dawn");
    expect(backgroundForVariant("tide", backgrounds, gradient)).toBe("tide");
    expect(backgroundForVariant("tide", backgrounds, photo)).toBe("sky");
    expect(backgroundForVariant("tide", backgrounds, null)).toBe("tide");
  });

  it("round-trips a config without changing it", () => {
    const config = { ...defaultConfig(), marketplaceUrl: "https://example.net/listing" };
    const parsed = parseConfig(fromForm(toForm(config, COLORS), CONFIG_VERSION));
    expect(parsed).toEqual({ ok: true, config });
  });

  it("reads only unambiguous thousands grouping in the minimum offer and never guesses a separator", () => {
    for (const [text, amount] of [
      ["25000", 25_000],
      ["25,000", 25_000],
      ["25.000", 25_000],
      [" 25 000 ", 25_000],
      ["1'250'000", 1_250_000],
      ["-5", -5],
    ] as const) {
      expect(readAmount(text), text).toBe(amount);
    }
    expect(readAmount("")).toBeUndefined();
    const form = toForm(defaultConfig(), COLORS);
    for (const text of ["1,5", "12,50", "12.5", "1,000.50", "1,00,000", "1.000,000", "25 000,00"]) {
      const parsed = parseConfig(fromForm({ ...form, minOffer: text }, 1));
      expect(parsed.ok ? null : errorsByField(parsed.errors).minOffer, text).toBe(
        "Enter the minimum offer as a whole number, like 1000.",
      );
    }
  });

  it("treats a stored config with one accent colour as what the form saves, so loading it changes nothing", () => {
    const stored = { ...defaultConfig(), accent: { primary: "#aa0000" } };
    const normalized = normalize(stored, COLORS);
    expect(normalized.accent).toEqual({ primary: "#aa0000", contrast: "#ffffff" });
    const fromTheForm = parseConfig(fromForm(toForm(stored, COLORS), CONFIG_VERSION));
    expect(fromTheForm.ok && configKey(fromTheForm.config)).toBe(configKey(normalized));
    expect(changedFields(normalized, normalize(stored, COLORS))).toEqual([]);
  });

  it("sends colours only when the override is on", () => {
    const form = toForm(defaultConfig(), COLORS);
    expect(form.accentOn).toBe(false);
    expect(fromForm(form, 1)).not.toHaveProperty("accent");
    const on = parseConfig(fromForm({ ...form, accentOn: true, accentPrimary: "#AA0000" }, 1));
    expect(on.ok && on.config.accent).toEqual({ primary: "#aa0000", contrast: "#ffffff" });
  });

  it("maps dotted schema paths to the input whose edit clears them", () => {
    expect(fieldOf("seo.title")).toBe("seoTitle");
    expect(fieldOf("accent.primary")).toBe("accentPrimary");
    expect(fieldOf("minOffer")).toBe("minOffer");
    expect(fieldOf("version")).toBe("form");
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

  it("shows what Publish would change, old to new", () => {
    const live = defaultConfig();
    const names = { background: (id: string) => `Background ${id}` };
    expect(describeChanges(live, live, names)).toEqual([]);
    const draft = {
      ...live,
      variant: "gradient" as const,
      headline: "A much longer headline that goes on well past the length that fits in one line",
      marketplaceUrl: undefined,
      accent: { primary: "#112233", contrast: "#ffffff" },
    };
    const changes = describeChanges(draft, { ...live, marketplaceUrl: "https://example.net/listing" }, names);
    expect(changes.map((change) => change.label)).toEqual(["Look", "Headline", "Marketplace link", "Colours"]);
    const [design, headline, link, colours] = changes;
    expect(design?.to).toEqual({ text: "Gradient", full: "Gradient" });
    expect(headline?.to.text).toBe("“A much longer headline that goes on…”");
    expect(headline?.to.full).toBe(draft.headline);
    expect(link).toMatchObject({ from: { text: "“https://example.net/listing”" }, to: { text: "None" } });
    expect(colours?.from.text).toBe("The design's own");
    expect(colours?.to).toMatchObject({ text: "#112233 on #ffffff", colors: ["#112233", "#ffffff"] });
  });

  it("truncates long text at a word, and keeps short text whole", () => {
    expect(truncate("Short")).toBe("Short");
    expect(truncate("one two  three\nfour", 40)).toBe("one two three four");
    expect(truncate("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
    expect(truncate("words that are cut here", 16)).toBe("words that are…");
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

  it("calls a publish stalled when its progress does not change for several steps", async () => {
    const { calls, deps } = fake(Array.from({ length: 10 }, () => running(2)));
    const outcome = await runPublish(deps);
    expect(outcome).toMatchObject({ status: "failed", reason: "stalled" });
    expect(outcome.status === "failed" && outcome.message).not.toContain("connection");
    expect(calls.filter((call) => call === "step 7")).toHaveLength(STALL_STEPS);
  });

  it("keeps going while the progress moves", async () => {
    const { deps } = fake([running(9), running(8), running(7), running(6), running(5), running(4), done]);
    expect(await runPublish(deps)).toEqual({ status: "done", message: "Published." });
  });

  it("gives up after the step limit", async () => {
    const { deps } = fake([running(3), running(2), running(1)]);
    expect(await runPublish({ ...deps, maxSteps: 2 })).toMatchObject({ status: "failed", reason: "stalled" });
  });

  it("stops sending steps once the page has gone away", async () => {
    const controller = new AbortController();
    const { calls, deps } = fake([running(3), running(2), done]);
    const outcome = await runPublish({
      ...deps,
      signal: controller.signal,
      onStep: (result) => {
        calls.push(`seen ${result.status}`);
        controller.abort();
      },
    });
    expect(outcome).toEqual({ status: "stopped" });
    expect(calls).toEqual(["start", "step 7", "seen running"]);
  });

  it("knows when a revert has already replaced the draft", () => {
    expect(revertWroteDraft({ ok: true, deploymentId: 1 })).toBe(true);
    expect(revertWroteDraft({ ok: false, reason: "unexpected", message: "x", deploymentId: 1 })).toBe(true);
    expect(revertWroteDraft({ ok: false, reason: "busy", message: "x", deploymentId: 1 })).toBe(false);
    expect(revertWroteDraft({ ok: false, reason: "invalid", message: "x" })).toBe(false);
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
    expect(free).toBe("free");
    expect(sleeps).toEqual([2000, 2000]);
  });

  it("gives up when polls keep failing, as with an expired session", async () => {
    let reads = 0;
    const ended = await waitUntilFree({
      read: async () => {
        reads += 1;
        throw new Error("401");
      },
      sleep: async () => {},
      signal: new AbortController().signal,
    });
    expect(ended).toBe("unreachable");
    expect(reads).toBe(3);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await waitUntilFree({ read: async () => ({ holder: 1 }), sleep: async () => {}, signal: controller.signal }),
    ).toBe("aborted");
  });
});

describe("the preview's HTML", () => {
  it("makes every link open a window the sandbox refuses, first thing in the head", () => {
    const html = inertPreview('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body></body></html>');
    expect(html).toMatch(/^<!doctype html><html lang="en"><head><base target="_blank"><style data-deparked-preview>/);
    expect(html).toContain(PREVIEW_LINK_HINT);
    expect(inertPreview("<p>no head</p>")).toMatch(/^<base target="_blank">.*<p>no head<\/p>$/s);
  });
});
