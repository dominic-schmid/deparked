import { type Config, defaultConfig } from "@deparked/config";
import {
  acquirePublishLock,
  config as configTable,
  type Db,
  getConfig,
  getDeployment,
  getDomain,
  getPublishLock,
  insertDeployment,
  insertDomain,
  insertTurnstileWidget,
  listConfigHistory,
  listSiteFiles,
  listSiteFilesByHost,
  replaceSiteFiles,
  saveDraft,
  setDomainStatus,
} from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { contentHash, HostingError } from "@deparked/hosting";
import { createFakeHosting, type FakeHosting } from "@deparked/hosting/testing";
import { catalog } from "@deparked/templates/catalog";
import { beforeEach, describe, expect, it } from "vitest";
import { sitePath } from "./files";
import {
  getPublishState,
  LOCK_TTL_MS,
  type PublishContext,
  revertTo,
  rollbackPublish,
  STEP_REQUEST_BUDGET,
  type StepResult,
  saveDraftConfig,
  startPublish,
  stepPublish,
} from "./pipeline";
import { createReleaseFileFetcher, parseReleaseBaseUrl } from "./release";

const SITEKEY = "1x00000000000000000000AA";
const A = "a.example";
const B = "b.example";
const FONT = "/catalog/fonts/a.woff2";
const FONT_BYTES = new TextEncoder().encode("font bytes");
const HEADERS = "/*\n  X-Content-Type-Options: nosniff\n";

let db: Db;
let hosting: FakeHosting;
let ctx: PublishContext;
let time: number;
let releaseFiles: Map<string, Uint8Array>;
let releaseRequests: string[];

beforeEach(async () => {
  ({ db } = await createTestDb());
  hosting = createFakeHosting();
  time = 1_800_000_000_000;
  releaseFiles = new Map([[FONT, FONT_BYTES]]);
  releaseRequests = [];
  ctx = {
    db,
    hosting,
    now: () => {
      time += 1000;
      return time;
    },
    catalog,
    headers: HEADERS,
    release: "1.0.0",
    fetchReleaseFile: async (path) => {
      releaseRequests.push(path);
      const content = releaseFiles.get(path);
      if (content === undefined) throw new Error(`no ${path} in the release`);
      return content;
    },
  };
  await insertTurnstileWidget(db, {
    sitekey: SITEKEY,
    name: "deparked-1",
    secretName: "TURNSTILE_SECRET_1",
    now: time,
  });
  await replaceSiteFiles(db, {
    host: null,
    files: [
      {
        path: FONT,
        hash: await contentHash(FONT, FONT_BYTES),
        size: FONT_BYTES.length,
        contentType: "font/woff2",
      },
    ],
    now: time,
  });
});

async function addDomain(host: string, config: Partial<Config> | null = {}): Promise<void> {
  await insertDomain(db, { domain: { host, zoneId: `zone-${host}`, turnstileWidgetId: SITEKEY }, now: time });
  if (config !== null) await draft(host, config);
}

async function draft(host: string, config: Partial<Config>): Promise<void> {
  expect(await saveDraftConfig(ctx, host, { ...defaultConfig(), ...config })).toEqual({ ok: true });
}

async function start(input: Parameters<typeof startPublish>[1]): Promise<number> {
  const started = await startPublish(ctx, input);
  if (!started.ok) throw new Error(`not started: ${started.message}`);
  return started.deploymentId;
}

async function run(deploymentId: number): Promise<StepResult[]> {
  const steps: StepResult[] = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const step = await stepPublish(ctx, deploymentId);
    steps.push(step);
    if (step.status !== "running") return steps;
  }
  throw new Error("the publish never finished");
}

async function publish(host: string): Promise<StepResult[]> {
  return run(await start({ host, kind: "draft" }));
}

const uploadedIn = (version: number) =>
  // The fake keeps content by hash, so a version's new files are the hashes no earlier version had.
  (hosting.versions[version]?.files ?? [])
    .filter((file) => !hosting.versions.slice(0, version).some((v) => v.files.some((f) => f.hash === file.hash)))
    .map((file) => file.path);

const paths = (files: readonly { path: string }[]) => files.map((file) => file.path).sort();

/** D1's manifest and what the host serves are the same set of files. */
async function expectInSync(): Promise<void> {
  const rows = await listSiteFiles(db);
  const live = hosting.liveFiles();
  expect(rows.map(({ path, hash, size }) => ({ path, hash, size }))).toEqual(
    live.map(({ path, hash, size }) => ({ path, hash, size })).sort((a, b) => a.path.localeCompare(b.path)),
  );
}

describe("publishing a draft", () => {
  it("first publish: renders three files, sends the whole manifest with the headers, records it in D1", async () => {
    await addDomain(A);

    const steps = await publish(A);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: "done", versionId: hosting.versions[0]?.id });
    // 3 fixed requests and one upload batch to the host, plus the catalog file downloaded from the release.
    expect(steps[0]?.progress).toMatchObject({ uploaded: 4, pending: 0, requests: 5 });
    expect(paths(hosting.liveFiles())).toEqual([
      FONT,
      `/sites/${A}/index.html`,
      `/sites/${A}/robots.txt`,
      `/sites/${A}/sitemap.xml`,
    ]);
    expect(hosting.versions[0]?.headers).toBe(HEADERS);
    await expectInSync();

    const stored = await getConfig(db, A);
    expect(stored?.liveJson).toBe(stored?.draftJson);
    expect(stored?.publishedRelease).toBe("1.0.0");
    expect(await listConfigHistory(db, { host: A })).toHaveLength(1);
    expect((await getDomain(db, A))?.status).toBe("live");
    const deployment = await getDeployment(db, 1);
    expect(deployment).toMatchObject({
      status: "done",
      kind: "publish",
      host: A,
      cfVersionId: hosting.versions[0]?.id,
    });
    expect(await getPublishLock(db)).toBeUndefined();
    expect(await getPublishState(ctx, A)).toMatchObject({ draftDiffers: false, lock: null, outOfSync: false });
  });

  it("bakes the domain's sitekey and beacon token into the page", async () => {
    await insertDomain(db, {
      domain: { host: A, zoneId: "zone", turnstileWidgetId: SITEKEY, analyticsBeaconToken: "beacon-token-1" },
      now: time,
    });
    await draft(A, {});
    let html = "";
    const original = hosting.publish;
    hosting.publish = async (input) => {
      html = new TextDecoder().decode(await input.getContent(`/sites/${A}/index.html`));
      return original(input);
    };

    await publish(A);

    expect(html).toContain(SITEKEY);
    expect(html).toContain("beacon-token-1");
  });

  it("a catalog file the host asks for comes from the release and is checked against the manifest", async () => {
    await addDomain(A);

    await publish(A);

    expect(releaseRequests).toEqual([FONT]);
  });

  it("refuses a release file that is not the one installed, and changes nothing", async () => {
    await addDomain(A);
    releaseFiles.set(FONT, new TextEncoder().encode("FONT BYTES"));

    const steps = await publish(A);

    expect(steps.at(-1)).toMatchObject({ status: "failed", reason: "hosting" });
    expect(steps.at(-1)?.message).toContain(FONT);
    expect(hosting.versions).toHaveLength(0);
    expect(await listSiteFilesByHost(db, A)).toEqual([]);
  });

  it("with other domains present, their files are reused: nothing of theirs is read or sent", async () => {
    await addDomain(A);
    await addDomain(B);
    await publish(A);
    releaseRequests.length = 0;

    const steps = await publish(B);

    expect(steps.at(-1)?.progress.uploaded).toBe(3);
    expect(uploadedIn(1).sort()).toEqual([
      `/sites/${B}/index.html`,
      `/sites/${B}/robots.txt`,
      `/sites/${B}/sitemap.xml`,
    ]);
    expect(releaseRequests).toEqual([]);
    expect(hosting.liveFiles()).toHaveLength(7);
    await expectInSync();
  });

  it("sends only the files that changed", async () => {
    await addDomain(A);
    await publish(A);
    await draft(A, { headline: "A better headline for {domain}" });
    expect((await getPublishState(ctx, A)).draftDiffers).toBe(true);

    const steps = await publish(A);

    expect(steps.at(-1)?.progress).toMatchObject({ uploaded: 1, requests: 4 });
    expect(uploadedIn(1)).toEqual([`/sites/${A}/index.html`]);
    expect(await listConfigHistory(db, { host: A })).toHaveLength(2);
  });

  it("publishing an unchanged draft again uploads nothing and still deploys the full manifest", async () => {
    await addDomain(A);
    await addDomain(B);
    await publish(A);
    await publish(B);
    releaseRequests.length = 0;

    const steps = await publish(A);

    expect(steps.at(-1)).toMatchObject({ status: "done", progress: { uploaded: 0, pending: 0 } });
    expect(uploadedIn(2)).toEqual([]);
    expect(hosting.liveFiles()).toHaveLength(7);
    expect(releaseRequests).toEqual([]);
    await expectInSync();
  });

  it("continues over several steps when the upload does not fit in one", async () => {
    hosting = createFakeHosting({ batchSize: 1 });
    ctx = { ...ctx, hosting, maxUploadBatches: 1 };
    await addDomain(A);

    const steps = await publish(A);

    expect(steps.map((step) => step.status)).toEqual(["running", "running", "running", "done"]);
    expect(steps[0]?.progress).toMatchObject({ uploaded: 1, pending: 3, requests: 3 });
    expect(steps[2]?.progress.pending).toBe(1);
    await expectInSync();
  });

  it("a first publish that must send many catalog files spreads over steps within the request budget", async () => {
    hosting = createFakeHosting({ batchSize: 10 });
    ctx = { ...ctx, hosting };
    const catalogFiles = [];
    for (let index = 0; index < 60; index += 1) {
      const path = `/catalog/img/${index}.avif`;
      const content = new TextEncoder().encode(`image ${index}`);
      releaseFiles.set(path, content);
      catalogFiles.push({
        path,
        hash: await contentHash(path, content),
        size: content.length,
        contentType: "image/avif",
      });
    }
    const font = await listSiteFilesByHost(db, null);
    await replaceSiteFiles(db, { host: null, files: [...font, ...catalogFiles], now: time });
    await addDomain(A);
    const downloads: number[] = [];
    const id = await start({ host: A, kind: "draft" });

    const steps: StepResult[] = [];
    for (let guard = 0; guard < 20 && steps.at(-1)?.status !== "done"; guard += 1) {
      const before = releaseRequests.length;
      steps.push(await stepPublish(ctx, id));
      downloads.push(releaseRequests.length - before);
      expect(steps.at(-1)?.status).not.toBe("failed");
    }

    expect(steps.length).toBeGreaterThan(1);
    expect(steps.at(-1)?.status).toBe("done");
    for (const [index, step] of steps.entries()) {
      expect(step.progress.requests).toBeLessThanOrEqual(STEP_REQUEST_BUDGET);
      expect(downloads[index]).toBeLessThanOrEqual(step.progress.requests);
    }
    await expectInSync();
  });

  async function addCatalogFiles(count: number): Promise<void> {
    const files = [];
    for (let index = 0; index < count; index += 1) {
      const path = `/catalog/img/${index}.avif`;
      const content = new TextEncoder().encode(`image ${index}`);
      releaseFiles.set(path, content);
      files.push({ path, hash: await contentHash(path, content), size: content.length, contentType: "image/avif" });
    }
    const font = await listSiteFilesByHost(db, null);
    await replaceSiteFiles(db, { host: null, files: [...font, ...files], now: time });
  }

  it("60 missing catalog files in one upload bucket finish in a few steps within the budget", async () => {
    ctx = { ...ctx, hosting: createFakeHosting({ batchSize: 100 }) };
    await addCatalogFiles(60);
    await addDomain(A);
    const id = await start({ host: A, kind: "draft" });

    const steps: StepResult[] = [];
    for (let guard = 0; guard < 6 && steps.at(-1)?.status !== "done"; guard += 1) {
      const before = releaseRequests.length;
      const step = await stepPublish(ctx, id);
      steps.push(step);
      expect(step.status).not.toBe("failed");
      expect(step.progress.uploaded).toBeGreaterThan(0);
      expect(step.progress.requests).toBeLessThanOrEqual(STEP_REQUEST_BUDGET);
      expect(releaseRequests.length - before).toBeLessThanOrEqual(step.progress.requests);
    }

    expect(steps.at(-1)?.status).toBe("done");
    expect(new Set(releaseRequests).size).toBe(61);
  });

  it("a step that cannot upload anything fails in plain words and frees the lock", async () => {
    await addDomain(A);
    const id = await start({ host: A, kind: "draft" });
    ctx.hosting.publish = async () => ({ done: false, uploaded: [], pending: 5, requests: 1 });

    const step = await stepPublish(ctx, id);

    expect(step).toMatchObject({ status: "failed", progress: { uploaded: 0 } });
    expect(step.message).toMatch(/without sending a file/);
    expect(await getPublishLock(db)).toBeUndefined();
    expect((await stepPublish(ctx, id)).status).toBe("failed");
  });

  it("stores the published config as the draft, so nothing differs right after a publish", async () => {
    await addDomain(A, null);
    // A draft as an older admin may have stored it: same config, other formatting.
    await saveDraft(db, { host: A, json: JSON.stringify(defaultConfig(), null, 2), schemaVersion: 1, now: time });

    await publish(A);

    const stored = await getConfig(db, A);
    expect(stored?.draftJson).toBe(stored?.liveJson);
    expect((await getPublishState(ctx, A)).draftDiffers).toBe(false);
  });

  it("keeps a draft that was saved while the publish ran", async () => {
    await addDomain(A, { headline: "First {domain}" });
    const original = hosting.publish;
    hosting.publish = async (input) => {
      await draft(A, { headline: "Edited meanwhile {domain}" });
      return original(input);
    };

    await publish(A);

    const stored = await getConfig(db, A);
    expect(stored?.draftJson).toContain("Edited meanwhile");
    expect(stored?.liveJson).toContain("First");
    expect((await getPublishState(ctx, A)).draftDiffers).toBe(true);
  });

  it("a draft publish of a domain turned off meanwhile fails and publishes nothing", async () => {
    await addDomain(A);
    const id = await start({ host: A, kind: "draft" });
    await setDomainStatus(db, { host: A, status: "off", now: time });

    const step = await stepPublish(ctx, id);

    expect(step).toMatchObject({ status: "failed", reason: "invalid" });
    expect(step.message).toContain("turned off");
    expect(hosting.versions).toHaveLength(0);
    expect((await getConfig(db, A))?.liveJson).toBeNull();
  });

  it("refuses a draft that is not valid, naming the field", async () => {
    await addDomain(A, null);
    await ctx.db.run(
      `INSERT INTO config (host, draft_json, draft_schema_version, updated_at) VALUES ('${A}', '{"version":1}', 1, 0)`,
    );

    const steps = await publish(A);

    expect(steps.at(-1)).toMatchObject({ status: "failed", reason: "invalid" });
    expect(hosting.versions).toHaveLength(0);
    expect(await getPublishLock(db)).toBeUndefined();
  });

  it("does not start without a domain or without a draft", async () => {
    await addDomain(A, null);

    expect(await startPublish(ctx, { host: "nobody.example", kind: "draft" })).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(await startPublish(ctx, { host: A, kind: "draft" })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await getDeployment(db, 1)).toBeUndefined();
  });
});

describe("the lock", () => {
  it("refuses a second publish while one runs, with a clear message", async () => {
    await addDomain(A);
    await addDomain(B);
    const first = await start({ host: A, kind: "draft" });

    const second = await startPublish(ctx, { host: B, kind: "draft" });

    expect(second).toEqual({
      ok: false,
      reason: "busy",
      message: "Another publish is running. Wait for it to finish, then try again.",
      deploymentId: first,
    });
    expect((await getPublishState(ctx, B)).lock?.deploymentId).toBe(first);
    expect((await run(first)).at(-1)?.status).toBe("done");
    expect((await startPublish(ctx, { host: B, kind: "draft" })).ok).toBe(true);
  });

  it("is renewed by every step", async () => {
    hosting = createFakeHosting({ batchSize: 1 });
    ctx = { ...ctx, hosting, maxUploadBatches: 1 };
    await addDomain(A);
    const id = await start({ host: A, kind: "draft" });
    const before = (await getPublishLock(db))?.expiresAt ?? 0;
    time += LOCK_TTL_MS - 60_000;

    expect((await stepPublish(ctx, id)).status).toBe("running");

    expect((await getPublishLock(db))?.expiresAt).toBeGreaterThan(before + LOCK_TTL_MS - 60_000);
  });

  it("lost while the host was deploying: records the live version, writes nothing else, reports out of sync", async () => {
    await addDomain(A);
    const id = await start({ host: A, kind: "draft" });
    let other = 0;
    const original = hosting.publish;
    hosting.publish = async (input) => {
      const result = await original(input);
      // The step outlived the lock and another publish took it.
      other = (await insertDeployment(db, { worker: "sites", kind: "update", now: time })).id;
      time += LOCK_TTL_MS + 1;
      expect(await acquirePublishLock(db, { deploymentId: other, ttlMs: LOCK_TTL_MS, now: time })).toBe(true);
      return result;
    };

    const step = await stepPublish(ctx, id);

    expect(step).toMatchObject({ status: "failed", reason: "lock-lost" });
    expect(step.message).not.toContain("Nothing was changed");
    expect(await listSiteFilesByHost(db, A)).toEqual([]);
    expect((await getConfig(db, A))?.liveJson).toBeNull();
    expect(await listConfigHistory(db, { host: A })).toEqual([]);
    expect((await getDomain(db, A))?.status).toBe("placeholder");
    expect(await getDeployment(db, id)).toMatchObject({ status: "failed", cfVersionId: hosting.versions[0]?.id });
    expect((await getPublishLock(db))?.deploymentId).toBe(other);
    expect((await getPublishState(ctx, A)).outOfSync).toBe(true);

    hosting.publish = original;
    time += LOCK_TTL_MS + 1;
    expect((await publish(A)).at(-1)?.status).toBe("done");
    expect((await getPublishState(ctx, A)).outOfSync).toBe(false);
  });

  it("two steps of the same publish at once: one commit, one history row, both answer done", async () => {
    await addDomain(A);
    const id = await start({ host: A, kind: "draft" });
    const original = hosting.publish;
    let inner: StepResult | undefined;
    hosting.publish = async (input) => {
      const result = await original(input);
      if (inner === undefined) {
        // A second request for the same deployment runs to the end while this one waits for the host.
        inner = {
          status: "running",
          progress: { uploaded: 0, pending: 0, remainingHosts: 0, requests: 0 },
          message: "",
        };
        inner = await stepPublish(ctx, id);
      }
      return result;
    };

    const outer = await stepPublish(ctx, id);

    expect(inner).toMatchObject({ status: "done" });
    expect(outer).toMatchObject({ status: "done" });
    expect(await listConfigHistory(db, { host: A })).toHaveLength(1);
    expect(await getDeployment(db, id)).toMatchObject({ status: "done" });
    expect(await getPublishLock(db)).toBeUndefined();
    await expectInSync();
  });

  it("lost before the step: nothing is sent to the host", async () => {
    await addDomain(A);
    const id = await start({ host: A, kind: "draft" });
    time += LOCK_TTL_MS + 1;

    const step = await stepPublish(ctx, id);

    expect(step).toMatchObject({ status: "failed", reason: "lock-lost" });
    expect(hosting.versions).toHaveLength(0);
    expect(await stepPublish(ctx, id)).toMatchObject({ status: "failed", reason: "earlier", message: step.message });
  });

  it("a crashed publish is marked failed by the next start, which then gets the lock", async () => {
    await addDomain(A);
    const crashed = await start({ host: A, kind: "draft" });
    time += LOCK_TTL_MS + 1;

    const next = await start({ host: A, kind: "draft" });

    expect(await getDeployment(db, crashed)).toMatchObject({ status: "failed" });
    expect((await getDeployment(db, crashed))?.error).toContain("stopped before it finished");
    expect((await run(next)).at(-1)?.status).toBe("done");
  });
});

describe("failures", () => {
  it("the host fails mid-way: D1 is untouched, the deployment failed, the lock is free", async () => {
    await addDomain(A);
    await publish(A);
    const before = await listSiteFiles(db);
    const live = (await getConfig(db, A))?.liveJson;
    await draft(A, { headline: "Changed {domain}" });
    hosting.failNext("publish", new HostingError("unavailable", "Cloudflare did not answer. Try again in a minute."));

    const steps = await publish(A);

    expect(steps).toEqual([
      {
        status: "failed",
        reason: "hosting",
        message: "Cloudflare did not answer. Try again in a minute.",
        progress: { uploaded: 0, pending: 0, remainingHosts: 1, requests: 0 },
      },
    ]);
    expect(await listSiteFiles(db)).toEqual(before);
    expect((await getConfig(db, A))?.liveJson).toBe(live);
    expect(await listConfigHistory(db, { host: A })).toHaveLength(1);
    expect(await getPublishState(ctx, A)).toMatchObject({
      draftDiffers: true,
      lock: null,
      lastDeployment: { status: "failed", error: "Cloudflare did not answer. Try again in a minute." },
    });
    expect((await publish(A)).at(-1)?.status).toBe("done");
  });

  it("rejected credentials are their own reason, for the token banner", async () => {
    await addDomain(A);
    hosting.rejectCredentials("publish");

    const steps = await publish(A);

    expect(steps.at(-1)).toMatchObject({ status: "failed", reason: "credentials-rejected" });
    expect(await getPublishLock(db)).toBeUndefined();
  });

  it("an unexpected error says nothing about its cause", async () => {
    await addDomain(A);
    hosting.failNext("publish", new Error("secret-looking internals"));

    const steps = await publish(A);

    expect(steps.at(-1)).toMatchObject({ status: "failed", reason: "unexpected" });
    expect(steps.at(-1)?.message).not.toContain("secret");
  });
});

describe("templates changed since another domain was published", () => {
  /** As if B's page had been rendered by older templates: the manifest lists a hash today's render does not give. */
  async function makeStale(host: string): Promise<void> {
    await db.run(`UPDATE site_files SET hash = '${"0".repeat(32)}' WHERE path = '/sites/${host}/index.html'`);
    await db.run(`UPDATE config SET published_release = '0.9.0' WHERE host = '${host}'`);
  }

  it("the host asks for that domain's file: it is rebuilt in the same deploy and its rows are replaced", async () => {
    await addDomain(A);
    await addDomain(B);
    await publish(A);
    await publish(B);
    await makeStale(B);
    await draft(A, { headline: "New {domain}" });

    const steps = await publish(A);

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe("done");
    await expectInSync();
    expect((await listSiteFilesByHost(db, B)).some((row) => row.hash === "0".repeat(32))).toBe(false);
    expect((await getConfig(db, B))?.publishedRelease).toBe("1.0.0");
    expect(await listConfigHistory(db, { host: B })).toHaveLength(1);
  });

  it("a domain whose live design is broken: the failure names it and says what to do", async () => {
    await addDomain(A);
    await addDomain(B);
    await publish(A);
    await publish(B);
    await makeStale(B);
    await db.run(`UPDATE config SET live_json = '{"broken"' WHERE host = '${B}'`);
    await draft(A, { headline: "New {domain}" });

    const steps = await publish(A);

    expect(steps.at(-1)).toMatchObject({ status: "failed", reason: "invalid" });
    expect(steps.at(-1)?.message).toContain(B);
    expect(steps.at(-1)?.message).toContain("turn it off");

    const all = await run(await start({ kind: "republish-all" }));
    expect(all.at(-1)).toMatchObject({ status: "failed", reason: "invalid" });
    expect(all.at(-1)?.message).toContain(B);
    expect(all.at(-1)?.message).toContain("turn it off");
  });

  it("a domain without a bot check: the failure names it and says what to do", async () => {
    await addDomain(A);
    await addDomain(B);
    await publish(A);
    await publish(B);
    await makeStale(B);
    await db.run(`UPDATE domains SET turnstile_widget_id = NULL WHERE host = '${B}'`);
    await draft(A, { headline: "New {domain}" });

    const steps = await publish(A);

    expect(steps.at(-1)).toMatchObject({ status: "failed", reason: "invalid" });
    expect(steps.at(-1)?.message).toContain(B);
    expect(steps.at(-1)?.message).toContain("turn it off");
  });

  it("too many stale domains in one step: fails and points at Republish all", async () => {
    const hosts = [B, "c.example", "d.example", "e.example"];
    await addDomain(A);
    for (const host of hosts) {
      await addDomain(host);
      await publish(host);
    }
    for (const host of hosts) await makeStale(host);

    const steps = await publish(A);

    expect(steps.at(-1)).toMatchObject({ status: "failed", reason: "invalid" });
    expect(steps.at(-1)?.message).toContain("Republish all");

    ctx = { ...ctx, hostsPerStep: 2 };
    const all = await run(await start({ kind: "republish-all" }));
    expect(all.at(-1)?.status).toBe("done");
    await expectInSync();
  });
});

describe("republish all", () => {
  it("rebuilds every domain a few per step, drops turned-off ones, and records the release", async () => {
    await addDomain(A);
    await addDomain(B);
    await addDomain("off.example");
    await addDomain("new.example", null);
    for (const host of [A, B, "off.example"]) await publish(host);
    await setDomainStatus(db, { host: "off.example", status: "off", now: time });
    const versions = hosting.versions.length;
    ctx = { ...ctx, release: "1.1.0", hostsPerStep: 2 };

    const steps = await run(await start({ kind: "republish-all" }));

    expect(steps.map((step) => [step.status, step.progress.remainingHosts])).toEqual([
      ["running", 2],
      ["done", 0],
    ]);
    expect(hosting.versions).toHaveLength(versions + 2);
    expect(await listSiteFilesByHost(db, "off.example")).toEqual([]);
    expect(await listSiteFilesByHost(db, "new.example")).toHaveLength(3);
    expect((await getDomain(db, "new.example"))?.status).toBe("placeholder");
    expect((await getConfig(db, A))?.publishedRelease).toBe("1.1.0");
    expect(await listConfigHistory(db, { host: A })).toHaveLength(1);
    await expectInSync();
  });

  it("with nothing to rebuild it still sends the manifest once", async () => {
    const steps = await run(await start({ kind: "republish-all" }));

    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe("done");
    expect(paths(hosting.liveFiles())).toEqual([FONT]);
  });
});

describe("placeholder and removal", () => {
  it("a new domain gets the placeholder and stays a placeholder until its first publish", async () => {
    await addDomain(A, null);

    const steps = await run(await start({ host: A, kind: "placeholder" }));

    expect(steps.at(-1)?.status).toBe("done");
    expect(await listSiteFilesByHost(db, A)).toHaveLength(3);
    expect((await getDomain(db, A))?.status).toBe("placeholder");
    expect(await getConfig(db, A)).toBeUndefined();
    expect(await getDeployment(db, 1)).toMatchObject({ kind: "install", host: A });

    await draft(A, {});
    await publish(A);
    expect((await getDomain(db, A))?.status).toBe("live");
  });

  it("turning a domain off takes its files out of the manifest and keeps its config", async () => {
    await addDomain(A);
    await addDomain(B);
    await publish(A);
    await publish(B);
    expect(await startPublish(ctx, { host: A, kind: "remove" })).toMatchObject({ ok: false, reason: "invalid" });
    await setDomainStatus(db, { host: A, status: "off", now: time });

    const steps = await run(await start({ host: A, kind: "remove" }));

    expect(steps.at(-1)?.status).toBe("done");
    expect(await listSiteFilesByHost(db, A)).toEqual([]);
    expect(paths(hosting.liveFiles()).some((path) => path.startsWith(`/sites/${A}/`))).toBe(false);
    expect((await getConfig(db, A))?.liveJson).not.toBeNull();
    expect((await getDomain(db, A))?.status).toBe("off");
    expect(await startPublish(ctx, { host: A, kind: "draft" })).toMatchObject({ ok: false, reason: "invalid" });
    await expectInSync();
  });
  it("an attach publishes the page while the domain is still off: the placeholder, or its live design again", async () => {
    await addDomain(A, null);
    await setDomainStatus(db, { host: A, status: "off", now: time });
    expect((await run(await start({ host: A, kind: "placeholder" }))).at(-1)?.status).toBe("done");
    expect(await listSiteFilesByHost(db, A)).toHaveLength(3);
    expect((await getDomain(db, A))?.status).toBe("off");

    await addDomain(B);
    await publish(B);
    const live = (await listSiteFilesByHost(db, B)).find((file) => file.path.endsWith("index.html"))?.hash;
    await setDomainStatus(db, { host: B, status: "off", now: time });
    await run(await start({ host: B, kind: "remove" }));
    expect(await listSiteFilesByHost(db, B)).toEqual([]);
    await run(await start({ host: B, kind: "placeholder" }));
    expect((await listSiteFilesByHost(db, B)).find((file) => file.path.endsWith("index.html"))?.hash).toBe(live);
    await expectInSync();
  });

  it("a removal finds the domain turned on again: fails instead of publishing it", async () => {
    await addDomain(A);
    await publish(A);
    await setDomainStatus(db, { host: A, status: "off", now: time });
    const id = await start({ host: A, kind: "remove" });
    const versions = hosting.versions.length;
    await setDomainStatus(db, { host: A, status: "live", now: time + 10_000 });

    const step = await stepPublish(ctx, id);

    expect(step).toMatchObject({ status: "failed", reason: "invalid" });
    expect(step.message).toContain("turned on again");
    expect(hosting.versions).toHaveLength(versions);
    expect(await listSiteFilesByHost(db, A)).toHaveLength(3);
  });

  it("refuses a domain row whose host could leave its folder", async () => {
    await db.run(
      `INSERT INTO domains (host, zone_id, turnstile_widget_id, status, created_at, updated_at) VALUES ('../evil', 'z', '${SITEKEY}', 'placeholder', 0, 0)`,
    );

    const steps = await run(await start({ kind: "republish-all" }));

    expect(steps.at(-1)).toMatchObject({ status: "failed", reason: "invalid" });
    expect(hosting.versions).toHaveLength(0);
    expect(() => sitePath("../evil", "index.html")).toThrow();
    expect(() => sitePath("a..example", "index.html")).toThrow();
    expect(() => sitePath(`${"a".repeat(254)}`, "index.html")).toThrow();
    expect(sitePath(A, "index.html")).toBe(`/sites/${A}/index.html`);
  });
});

describe("revert and rollback", () => {
  it("revert publishes an earlier config as the new draft and live config", async () => {
    await addDomain(A, { headline: "First {domain}" });
    await publish(A);
    await draft(A, { headline: "Second {domain}" });
    await publish(A);
    const first = (await listConfigHistory(db, { host: A })).at(-1);
    await draft(A, { headline: "Unpublished {domain}" });

    const started = await revertTo(ctx, first?.id ?? 0);
    if (!started.ok) throw new Error(started.message);
    const steps = await run(started.deploymentId);

    expect(steps.at(-1)?.status).toBe("done");
    const stored = await getConfig(db, A);
    expect(stored?.liveJson).toBe(first?.json);
    expect(stored?.draftJson).toBe(first?.json);
    expect(await listConfigHistory(db, { host: A })).toHaveLength(3);
    expect(hosting.liveFiles()).toEqual(hosting.versions[0]?.files);
    expect(await revertTo(ctx, 999)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("a revert whose draft cannot be saved fails the publish and frees the lock", async () => {
    await addDomain(A);
    await publish(A);
    const entry = (await listConfigHistory(db, { host: A }))[0];
    const failing = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "insert") return Reflect.get(target, property, receiver);
        return (table: unknown) => {
          if (table === configTable) throw new Error("D1 is unavailable");
          return target.insert(table as typeof configTable);
        };
      },
    });

    const started = await revertTo({ ...ctx, db: failing }, entry?.id ?? 0);

    expect(started).toMatchObject({ ok: false, reason: "unexpected", deploymentId: 2 });
    expect(await getPublishLock(db)).toBeUndefined();
    expect(await getDeployment(db, 2)).toMatchObject({ status: "failed" });
  });

  it("emergency rollback puts the old version live and reports out of sync until the next publish", async () => {
    await addDomain(A, { headline: "First {domain}" });
    await publish(A);
    await draft(A, { headline: "Second {domain}" });
    await publish(A);

    const rolledBack = await rollbackPublish(ctx, { deploymentId: 1 });

    expect(rolledBack.ok).toBe(true);
    expect(hosting.liveFiles()).toEqual(hosting.versions[0]?.files);
    expect(await getPublishState(ctx, A)).toMatchObject({ outOfSync: true, lock: null });

    await run(await start({ kind: "republish-all" }));
    expect((await getPublishState(ctx, A)).outOfSync).toBe(false);
    await expectInSync();
  });

  it("a rollback the host refuses fails without holding the lock", async () => {
    await addDomain(A);
    await publish(A);
    hosting.rejectCredentials("rollback");

    expect(await rollbackPublish(ctx, { deploymentId: 1 })).toMatchObject({
      ok: false,
      reason: "credentials-rejected",
    });
    expect(await rollbackPublish(ctx, { versionId: "gone" })).toMatchObject({ ok: false, reason: "hosting" });
    expect(await rollbackPublish(ctx, { deploymentId: 99 })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await getPublishLock(db)).toBeUndefined();
  });
});

describe("saving a draft", () => {
  it("returns field errors and stores nothing for a config that is not valid", async () => {
    await addDomain(A, null);

    const result = await saveDraftConfig(ctx, A, { ...defaultConfig(), variant: "no-such-variant" });

    expect(result.ok).toBe(false);
    expect(await getConfig(db, A)).toBeUndefined();
    expect(await saveDraftConfig(ctx, "nobody.example", defaultConfig())).toMatchObject({ ok: false });
  });
});

describe("the release file fetcher", () => {
  it("fetches base URL + path without following redirects and fails readably when the file is missing", async () => {
    const requested: { url: string; redirect: RequestRedirect | undefined }[] = [];
    const fetcher = createReleaseFileFetcher({
      baseUrl: "https://release.example/v1",
      fetch: async (url, init) => {
        requested.push({ url, redirect: init.redirect });
        if (url.endsWith("/moved.avif")) return new Response(null, { status: 302, headers: { location: "/x" } });
        return url.endsWith(FONT) ? new Response(FONT_BYTES) : new Response("no", { status: 404 });
      },
    });

    expect(await fetcher(FONT, FONT_BYTES.length)).toEqual(FONT_BYTES);
    expect(requested).toEqual([{ url: `https://release.example/v1${FONT}`, redirect: "manual" }]);
    await expect(fetcher("/catalog/missing.avif", 10)).rejects.toThrow("status 404");
    await expect(fetcher("/catalog/moved.avif", 10)).rejects.toThrow("status 302");
    await expect(createReleaseFileFetcher({ baseUrl: null })(FONT, 10)).rejects.toThrow("no release is installed");
  });

  it("refuses a file larger than the manifest says, by its header or by its body", async () => {
    const big = new Uint8Array(1000);
    const byHeader = createReleaseFileFetcher({
      baseUrl: "https://release.example",
      fetch: async () => new Response(big, { headers: { "content-length": "1000" } }),
    });
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < 10; index += 1) controller.enqueue(new Uint8Array(100));
          controller.close();
        },
      });
    const byBody = createReleaseFileFetcher({
      baseUrl: "https://release.example",
      fetch: async () => new Response(stream()),
    });

    await expect(byHeader(FONT, 10)).rejects.toThrow("larger");
    await expect(byBody(FONT, 10)).rejects.toThrow("larger");
    expect(await byBody(FONT, 1000)).toHaveLength(1000);
  });

  it("accepts only an https base URL, or http on this machine", () => {
    expect(parseReleaseBaseUrl("https://release.example/v1/")).toBe("https://release.example/v1");
    expect(parseReleaseBaseUrl("http://127.0.0.1:8787/files")).toBe("http://127.0.0.1:8787/files");
    expect(parseReleaseBaseUrl("http://localhost:9000")).toBe("http://localhost:9000");
    for (const value of [
      undefined,
      "",
      "http://release.example",
      "http://127.0.0.1.evil.example/",
      "http://localhost.evil.example",
      "https://user:pass@release.example",
      "https://release.example/?x=1",
      "ftp://release.example",
      "not a url",
    ]) {
      expect(parseReleaseBaseUrl(value)).toBeNull();
    }
  });
});
