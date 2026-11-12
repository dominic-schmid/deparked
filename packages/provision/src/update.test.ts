import { createCloudflareClient } from "@deparked/cf";
import { createMockCloudflare } from "@deparked/cf/mock";
import {
  finishDeployment,
  getReleaseState,
  getWorkspace,
  insertDeployment,
  listSiteFilesByHost,
  migrations,
} from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { describe, expect, it } from "vitest";
import type { ProvisionContext } from "./context";
import { planInstallHub } from "./hub";
import { releaseFromUrl } from "./release";
import { PLAN_START, type PlanState, runNextStep, type StepReport } from "./steps";
import { buildFakeRelease, FAKE_FILES, type FakeFile } from "./test-release";
import {
  beginRollback,
  beginUpdate,
  currentChange,
  finishReleaseChange,
  isNewer,
  previewUpdate,
  type ReleasePin,
  rollbackTarget,
  runReleaseStep,
  type UpdateOptions,
} from "./update";

const TOKEN = "test-token-never-shown";

/** Release B: a changed admin module and a new catalog file; the same database schema as A. */
const B_FILES: FakeFile[] = [
  ...FAKE_FILES.filter((file) => file.path !== "index.js"),
  {
    pack: "admin-modules",
    path: "index.js",
    body: "export default { fetch() { return new Response('b') } }",
    contentType: "application/javascript+module",
  },
  { pack: "catalog", path: "/catalog/fonts/b.woff2", body: "font-b", contentType: "font/woff2" },
];

/** Release C: B plus one more migration, so a database updated to C is newer than A supports. */
const C_FILES: FakeFile[] = [
  ...B_FILES,
  {
    pack: "migrations",
    path: "0099_update_test.sql",
    body: 'CREATE TABLE IF NOT EXISTS "update_test" ("id" integer PRIMARY KEY NOT NULL)',
    contentType: "application/sql",
  },
];

async function setup() {
  const mock = createMockCloudflare({ token: TOKEN });
  const { d1, db } = await createTestDb();
  mock.attachDatabase("deparked", d1);
  const cf = createCloudflareClient({
    token: TOKEN,
    accountId: mock.state.accountId,
    fetch: mock.fetch,
    baseUrl: "https://mock.test/client/v4",
    sleep: async () => {},
    random: () => 1,
  });
  let clock = 1_700_000_000_000;
  const ctx: ProvisionContext = { cf, db, now: () => (clock += 1) };
  const a = await buildFakeRelease("1.0.0");
  const b = await buildFakeRelease("1.1.0", B_FILES);
  const c = await buildFakeRelease("1.2.0", C_FILES);
  const releases = new Map([
    ["1.0.0", a],
    ["1.1.0", b],
    ["1.2.0", c],
  ]);
  let offline = false;
  let downloads = 0;
  const fetch = async (url: string) => {
    if (offline) throw new TypeError("network down");
    downloads += 1;
    const version = /\/v([^/]+)\//.exec(url)?.[1] ?? "";
    return (releases.get(version)?.fetch ?? (async () => new Response("", { status: 404 })))(url);
  };
  const options: UpdateOptions = {
    token: TOKEN,
    release: (pin) =>
      releaseFromUrl({ baseUrl: `https://releases.example.com/v${pin.version}`, pinnedSha256: pin.sha256, fetch }),
  };
  const pinA: ReleasePin = { version: "1.0.0", sha256: a.sha256 };
  const pinB: ReleasePin = { version: "1.1.0", sha256: b.sha256 };
  const pinC: ReleasePin = { version: "1.2.0", sha256: c.sha256 };

  // Release A, installed as the installer does.
  let state = PLAN_START;
  for (;;) {
    const report = await runNextStep(planInstallHub(ctx, { release: options.release(pinA), token: TOKEN }), state);
    if (report.outcome !== "ran" && report.outcome !== "already-done") throw new Error(report.message);
    state = report.state;
    if (report.finished) break;
  }
  return {
    mock,
    db,
    d1,
    ctx,
    options,
    b,
    pinA,
    pinB,
    pinC,
    downloads: () => downloads,
    setOffline: (value: boolean) => {
      offline = value;
    },
  };
}

type Context = Awaited<ReturnType<typeof setup>>;

/** Each step is a new request: a new release source, from the state the browser sends back. */
async function runAll(context: Context, from: PlanState = PLAN_START): Promise<StepReport[]> {
  const reports: StepReport[] = [];
  let state = from;
  for (let count = 0; count < 10; count += 1) {
    const report = await runReleaseStep(context.ctx, context.options, state);
    reports.push(report);
    state = report.state;
    if (report.finished || (report.outcome !== "ran" && report.outcome !== "already-done")) return reports;
  }
  throw new Error("the change did not end");
}

/** What the admin does after the steps: "republish all", recorded as the publish pipeline records it. */
async function republish(context: Context) {
  const row = await insertDeployment(context.db, { worker: "sites", kind: "update", now: context.ctx.now() });
  await finishDeployment(context.db, { id: row.id, status: "done", now: context.ctx.now() });
}

const adminRelease = (context: Context) =>
  context.mock.liveBindings("deparked-admin").find((binding) => binding.name === "DEPARKED_RELEASE");

describe("updating the hub", () => {
  it("checks, migrates, uploads both Workers with the new release and keeps the admin's secrets", async () => {
    const context = await setup();
    const { mock, db, ctx, pinA, pinB } = context;
    const sessionKey = mock.liveBindings("deparked-admin").find((binding) => binding.name === "SESSION_KEY");
    expect(adminRelease(context)).toMatchObject({ type: "plain_text", text: "1.0.0" });
    expect(await getReleaseState(db)).toMatchObject({
      installedSha256: pinA.sha256,
      installedSchema: migrations.at(-1)?.name,
    });

    const preview = await previewUpdate(ctx, context.options, pinB);
    expect(preview).toMatchObject({ ok: true, rollback: { possible: true } });
    expect(preview.ok && preview.report.steps.map((step) => [step.id, step.status])).toEqual([
      ["download", "needed"],
      ["migrate", "done"],
      ["sites", "needed"],
      ["admin", "needed"],
    ]);

    expect(await beginUpdate(ctx, pinB)).toMatchObject({ ok: true });
    const reports: StepReport[] = [];
    let state = PLAN_START;
    for (;;) {
      // Every subrequest of one step: Cloudflare calls and release downloads. Workers Free allows 50.
      const before = { calls: mock.calls.length, downloads: context.downloads() };
      const report = await runReleaseStep(ctx, context.options, state);
      const subrequests = mock.calls.length - before.calls + context.downloads() - before.downloads;
      expect(subrequests, report.step?.id).toBeLessThanOrEqual(15);
      reports.push(report);
      state = report.state;
      if (report.finished) break;
    }
    expect(reports.map((report) => [report.step?.id, report.outcome])).toEqual([
      ["download", "ran"],
      ["migrate", "already-done"],
      ["sites", "ran"],
      ["admin", "ran"],
    ]);

    expect(adminRelease(context)).toMatchObject({ text: "1.1.0" });
    expect(mock.liveBindings("deparked-admin").find((binding) => binding.name === "SESSION_KEY")).toEqual(sessionKey);
    expect(mock.deployedAssets("deparked-sites").has("/catalog/fonts/b.woff2")).toBe(true);
    expect((await listSiteFilesByHost(db, null)).map((row) => row.path)).toContain("/catalog/fonts/b.woff2");
    expect(await getWorkspace(db)).toMatchObject({ installedRelease: "1.1.0" });
    expect(await getReleaseState(db)).toMatchObject({
      installedSha256: pinB.sha256,
      previousVersion: "1.0.0",
      previousSha256: pinA.sha256,
    });

    // Finishing needs every page published again after the new admin was uploaded.
    expect(await finishReleaseChange(ctx)).toMatchObject({
      ok: false,
      message: expect.stringContaining("published again"),
    });
    await republish(context);
    expect(await finishReleaseChange(ctx)).toMatchObject({ ok: true });
    expect(await currentChange(ctx)).toMatchObject({ kind: "update", finished: true });
  });

  it("refuses to finish with a republish from before the new admin was uploaded", async () => {
    const context = await setup();
    await beginUpdate(context.ctx, context.pinB);
    await republish(context);
    await runAll(context);
    expect(await finishReleaseChange(context.ctx)).toMatchObject({ ok: false });
  });

  it("continues where it stopped when a step fails, at every step", async () => {
    const context = await setup();
    const { mock, ctx, pinB } = context;
    await beginUpdate(ctx, pinB);
    const failures: (() => void)[] = [
      () => context.setOffline(true),
      () => mock.failNext({ route: "d1.list", status: 500, times: 3 }),
      () => mock.failNext({ route: "workers.uploadScript", status: 500, times: 3 }),
      () => mock.failNext({ route: "workers.uploadScript", status: 500, times: 3 }),
    ];
    let state = PLAN_START;
    for (const [index, fail] of failures.entries()) {
      fail();
      const failed = await runReleaseStep(ctx, context.options, state);
      expect([failed.step?.index, failed.outcome]).toEqual([index, "failed"]);
      expect(failed.state).toEqual(state);
      context.setOffline(false);
      const retried = await runReleaseStep(ctx, context.options, state);
      expect(retried.step?.index).toBe(index);
      expect(["ran", "already-done"]).toContain(retried.outcome);
      state = retried.state;
    }
    expect(adminRelease(context)).toMatchObject({ text: "1.1.0" });
    expect(await beginUpdate(ctx, pinB)).toMatchObject({ ok: true });
    expect((await runAll(context)).every((report) => report.outcome === "already-done")).toBe(true);
  });

  it("stops at the check when a pack was altered, before anything changes", async () => {
    const context = await setup();
    const { mock, ctx, b, pinB } = context;
    const pack = b.assets.get("deparked-1.1.0-admin-modules.pack") ?? new Uint8Array();
    pack[0] = (pack[0] ?? 0) ^ 1;
    await beginUpdate(ctx, pinB);
    mock.calls.length = 0;
    const [report] = await runAll(context);
    expect(report).toMatchObject({ outcome: "failed", step: { id: "download" } });
    expect(report?.message).toContain("does not match release.json");
    expect(mock.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(adminRelease(context)).toMatchObject({ text: "1.0.0" });
  });

  it("refuses a release.json that is not the confirmed one", async () => {
    const context = await setup();
    await beginUpdate(context.ctx, { ...context.pinB, sha256: "0".repeat(64) });
    const [report] = await runAll(context);
    expect(report).toMatchObject({ outcome: "failed", step: { id: "download" } });
    expect(report?.message).toContain("not the one this installer trusts");
  });

  it("refuses an older or the same version, and a second update while one runs", async () => {
    const context = await setup();
    const { ctx, pinA, pinB } = context;
    expect(await beginUpdate(ctx, pinA)).toMatchObject({ ok: false, message: expect.stringContaining("not newer") });
    expect(await previewUpdate(ctx, context.options, pinA)).toMatchObject({ ok: false });
    expect(await beginUpdate(ctx, { version: "1.0.0-rc.1", sha256: pinB.sha256 })).toMatchObject({ ok: false });
    expect(await beginUpdate(ctx, { version: "1.1.0; drop", sha256: pinB.sha256 })).toMatchObject({ ok: false });
    expect(await beginUpdate(ctx, pinB)).toMatchObject({ ok: true });
    expect(await beginUpdate(ctx, { version: "1.2.0", sha256: pinB.sha256 })).toMatchObject({
      ok: false,
      message: expect.stringContaining("not finished"),
    });
    expect(await finishReleaseChange(ctx)).toMatchObject({ ok: false });
  });

  it("orders versions by semver: a release is newer than its pre-releases", () => {
    expect(isNewer("1.2.0", "1.2.0-rc.3")).toBe(true);
    expect(isNewer("1.2.0-rc.10", "1.2.0-rc.9")).toBe(true);
    expect(isNewer("1.2.0-rc.1", "1.2.0")).toBe(false);
  });

  it("refuses a step beyond the last one done, whatever index the browser sends", async () => {
    const context = await setup();
    const { mock, ctx, pinB } = context;
    await beginUpdate(ctx, pinB);
    mock.calls.length = 0;
    for (const next of [3, 2, 1, 99]) {
      expect((await runReleaseStep(ctx, context.options, { next })).outcome).toBe("blocked");
    }
    expect(mock.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(adminRelease(context)).toMatchObject({ text: "1.0.0" });
    const fresh = await setup();
    expect(await runReleaseStep(fresh.ctx, fresh.options, PLAN_START)).toMatchObject({ outcome: "blocked" });
  });

  it("runs nothing for a page still driving an update that a rollback replaced", async () => {
    const context = await setup();
    const { mock, ctx, pinB } = context;
    await beginUpdate(ctx, pinB);
    const [verified] = await runAll(context).then((reports) => reports.slice(0, 1));
    expect(verified?.outcome).toBe("ran");
    expect(await beginRollback(ctx)).toMatchObject({ ok: true });
    mock.calls.length = 0;
    const stale = await runReleaseStep(ctx, context.options, { next: 3 }, { kind: "update", pin: pinB });
    expect(stale).toMatchObject({ outcome: "blocked", message: expect.stringContaining("Another update or rollback") });
    expect(mock.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
});

describe("rolling back", () => {
  it("installs the release from before the update again", async () => {
    const context = await setup();
    const { mock, db, ctx, pinA, pinB } = context;
    expect(await beginRollback(ctx)).toMatchObject({ ok: false });
    await beginUpdate(ctx, pinB);
    await runAll(context);
    await republish(context);
    await finishReleaseChange(ctx);
    const sessionKey = mock.liveBindings("deparked-admin").find((binding) => binding.name === "SESSION_KEY");

    expect(await rollbackTarget(ctx)).toMatchObject({ pin: pinA, possible: true });
    expect(await beginRollback(ctx)).toMatchObject({ ok: true, change: { kind: "rollback", pin: pinA } });
    const reports = await runAll(context);
    expect(reports.map((report) => [report.step?.id, report.outcome])).toEqual([
      ["download", "ran"],
      ["migrate", "already-done"],
      ["sites", "ran"],
      ["admin", "ran"],
    ]);
    expect(adminRelease(context)).toMatchObject({ text: "1.0.0" });
    expect(mock.liveBindings("deparked-admin").find((binding) => binding.name === "SESSION_KEY")).toEqual(sessionKey);
    expect(mock.deployedAssets("deparked-sites").has("/catalog/fonts/b.woff2")).toBe(false);
    expect(await getWorkspace(db)).toMatchObject({ installedRelease: "1.0.0" });
    expect(await getReleaseState(db)).toMatchObject({ installedSha256: pinA.sha256, previousVersion: null });
    await republish(context);
    expect(await finishReleaseChange(ctx)).toMatchObject({ ok: true });
    expect(await beginRollback(ctx)).toMatchObject({ ok: false });
  });

  it("is refused when the update changed the database, and the preview says so before it starts", async () => {
    const context = await setup();
    const { ctx, pinC } = context;
    const preview = await previewUpdate(ctx, context.options, pinC);
    expect(preview).toMatchObject({
      ok: true,
      rollback: { possible: false, reason: expect.stringContaining("changes the database") },
    });
    await beginUpdate(ctx, pinC);
    const reports = await runAll(context);
    expect(reports[1]).toMatchObject({ step: { id: "migrate" }, outcome: "ran" });
    expect(await context.d1.prepare("SELECT id FROM update_test").all()).toMatchObject({ results: [] });
    expect(await rollbackTarget(ctx)).toMatchObject({
      possible: false,
      reason: expect.stringContaining("cannot run on it"),
    });
    expect(await beginRollback(ctx)).toMatchObject({ ok: false, message: expect.stringContaining("not possible") });
    const applied = await context.d1.prepare("SELECT name FROM d1_migrations").all<{ name: string }>();
    expect(applied.results.map((row) => row.name)).toEqual([...migrations.map((m) => m.name), "0099_update_test.sql"]);
  });

  it("is not offered for an install whose checksum was never recorded", async () => {
    const context = await setup();
    await context.d1.prepare("UPDATE release_state SET installed_sha256 = NULL").run();
    expect(await previewUpdate(context.ctx, context.options, context.pinB)).toMatchObject({
      rollback: { possible: false, reason: expect.stringContaining("not recorded") },
    });
    await beginUpdate(context.ctx, context.pinB);
    expect(await rollbackTarget(context.ctx)).toMatchObject({ possible: false });
  });

  it("is the way out of an update that failed half way", async () => {
    const context = await setup();
    const { mock, ctx, pinB } = context;
    await beginUpdate(ctx, pinB);
    mock.failNext({ route: "workers.uploadScript", nth: 2, status: 500, times: 5 });
    const reports = await runAll(context);
    expect(reports.at(-1)).toMatchObject({ outcome: "failed", step: { id: "admin" } });
    expect(await beginRollback(ctx)).toMatchObject({ ok: true });
    const back = await runAll(context);
    expect(back.at(-1)?.finished).toBe(true);
    expect(mock.deployedAssets("deparked-sites").has("/catalog/fonts/b.woff2")).toBe(false);
    expect(adminRelease(context)).toMatchObject({ text: "1.0.0" });
  });
});
