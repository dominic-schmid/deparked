import { createCloudflareClient } from "@deparked/cf";
import { createMockCloudflare } from "@deparked/cf/mock";
import { getReleaseState, getWorkspace, listSiteFilesByHost, migrations } from "@deparked/db";
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
  previewUpdate,
  type ReleasePin,
  runReleaseStep,
  type UpdateOptions,
} from "./update";

const TOKEN = "test-token-never-shown";

/** Release B: a changed admin module, a new catalog file and one more migration. */
const B_FILES: FakeFile[] = [
  ...FAKE_FILES.filter((file) => file.path !== "index.js"),
  {
    pack: "admin-modules",
    path: "index.js",
    body: "export default { fetch() { return new Response('b') } }",
    contentType: "application/javascript+module",
  },
  { pack: "catalog", path: "/catalog/fonts/b.woff2", body: "font-b", contentType: "font/woff2" },
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
  const releases = new Map([
    ["1.0.0", a],
    ["1.1.0", b],
  ]);
  let offline = false;
  const fetch = async (url: string) => {
    if (offline) throw new TypeError("network down");
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
    a,
    b,
    pinA,
    pinB,
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

const adminRelease = (context: Context) =>
  context.mock.liveBindings("deparked-admin").find((binding) => binding.name === "DEPARKED_RELEASE");

describe("updating the hub", () => {
  it("checks, migrates, uploads both Workers with the new release and keeps the admin's secrets", async () => {
    const context = await setup();
    const { mock, db, ctx, pinA, pinB } = context;
    const sessionKey = mock.liveBindings("deparked-admin").find((binding) => binding.name === "SESSION_KEY");
    expect(adminRelease(context)).toMatchObject({ type: "plain_text", text: "1.0.0" });
    expect(await getReleaseState(db)).toMatchObject({ installedSha256: pinA.sha256 });

    const preview = await previewUpdate(ctx, context.options, pinB);
    expect(preview.ok && preview.report.steps.map((step) => [step.id, step.status])).toEqual([
      ["download", "needed"],
      ["migrate", "needed"],
      ["sites", "needed"],
      ["admin", "needed"],
    ]);

    expect(await beginUpdate(ctx, pinB)).toMatchObject({ ok: true });
    const reports = await runAll(context);
    expect(reports.map((report) => [report.step?.id, report.outcome])).toEqual([
      ["download", "ran"],
      ["migrate", "ran"],
      ["sites", "ran"],
      ["admin", "ran"],
    ]);
    expect(reports.at(-1)?.finished).toBe(true);
    for (const report of reports) expect(report.requests).toBeLessThan(20);

    expect(adminRelease(context)).toMatchObject({ text: "1.1.0" });
    expect(mock.liveBindings("deparked-admin").find((binding) => binding.name === "SESSION_KEY")).toEqual(sessionKey);
    expect(mock.liveBindings("deparked-admin").find((binding) => binding.name === "CF_API_TOKEN")).toMatchObject({
      text: TOKEN,
    });
    expect(mock.deployedAssets("deparked-sites").has("/catalog/fonts/b.woff2")).toBe(true);
    expect((await listSiteFilesByHost(db, null)).map((row) => row.path)).toContain("/catalog/fonts/b.woff2");
    expect(await context.d1.prepare("SELECT id FROM update_test").all()).toMatchObject({ results: [] });
    expect(await getWorkspace(db)).toMatchObject({ installedRelease: "1.1.0" });
    expect(await getReleaseState(db)).toMatchObject({
      installedSha256: pinB.sha256,
      previousVersion: "1.0.0",
      previousSha256: pinA.sha256,
    });

    expect(await finishReleaseChange(ctx)).toMatchObject({ ok: true });
    expect(await currentChange(ctx)).toMatchObject({ kind: "update", finished: true });
  });

  it("continues where it stopped when a step fails, at every step", async () => {
    const context = await setup();
    const { mock, ctx, pinB } = context;
    await beginUpdate(ctx, pinB);
    const failures: (() => void)[] = [
      () => context.setOffline(true),
      () => mock.failNext({ route: "d1.query", status: 500 }),
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
      mock.calls.length = 0;
      // Retry: the same call again, as the browser's Retry sends it.
      const retried = await runReleaseStep(ctx, context.options, state);
      expect([retried.step?.index, retried.outcome]).toEqual([index, "ran"]);
      state = retried.state;
    }
    expect(adminRelease(context)).toMatchObject({ text: "1.1.0" });
    // Starting the same update again (a reload) resumes it; every step is then done.
    expect(await beginUpdate(ctx, pinB)).toMatchObject({ ok: true });
    expect((await runAll(context)).map((report) => report.outcome)).toEqual([
      "already-done",
      "already-done",
      "already-done",
      "already-done",
    ]);
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
    const forged = { ...context.pinB, sha256: "0".repeat(64) };
    await beginUpdate(context.ctx, forged);
    const [report] = await runAll(context);
    expect(report).toMatchObject({ outcome: "failed", step: { id: "download" } });
    expect(report?.message).toContain("not the one this installer trusts");
  });

  it("refuses an older or the same version, and a second update while one runs", async () => {
    const context = await setup();
    const { ctx, pinA, pinB } = context;
    expect(await beginUpdate(ctx, pinA)).toMatchObject({ ok: false, message: expect.stringContaining("not newer") });
    expect(await previewUpdate(ctx, context.options, pinA)).toMatchObject({ ok: false });
    expect(await beginUpdate(ctx, { version: "0.9.0", sha256: pinA.sha256 })).toMatchObject({ ok: false });
    expect(await beginUpdate(ctx, { version: "1.1.0; drop", sha256: pinB.sha256 })).toMatchObject({ ok: false });
    expect(await beginUpdate(ctx, pinB)).toMatchObject({ ok: true });
    expect(await beginUpdate(ctx, { version: "1.2.0", sha256: pinB.sha256 })).toMatchObject({
      ok: false,
      message: expect.stringContaining("not finished"),
    });
    expect(await finishReleaseChange(ctx)).toMatchObject({ ok: false });
  });

  it("refuses a step whose earlier steps are not done, whatever index the browser sends", async () => {
    const context = await setup();
    const { mock, ctx, pinB } = context;
    await beginUpdate(ctx, pinB);
    mock.calls.length = 0;
    for (const next of [3, 2, 1, 99]) {
      const report = await runReleaseStep(ctx, context.options, { next });
      expect(report.outcome).toBe("blocked");
    }
    expect(mock.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(adminRelease(context)).toMatchObject({ text: "1.0.0" });
    // Without a started update there is nothing to run.
    const fresh = await setup();
    expect(await runReleaseStep(fresh.ctx, fresh.options, PLAN_START)).toMatchObject({ outcome: "blocked" });
  });
});

describe("rolling back", () => {
  it("installs the release from before the update again; the database keeps its migrations", async () => {
    const context = await setup();
    const { mock, db, ctx, pinA, pinB } = context;
    expect(await beginRollback(ctx)).toMatchObject({ ok: false });
    await beginUpdate(ctx, pinB);
    await runAll(context);
    await finishReleaseChange(ctx);
    const sessionKey = mock.liveBindings("deparked-admin").find((binding) => binding.name === "SESSION_KEY");

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
    // Forward-only: B's table stays.
    expect(await context.d1.prepare("SELECT id FROM update_test").all()).toMatchObject({ results: [] });
    const applied = await context.d1.prepare("SELECT name FROM d1_migrations").all<{ name: string }>();
    expect(applied.results.map((row) => row.name)).toEqual([...migrations.map((m) => m.name), "0099_update_test.sql"]);

    expect(await finishReleaseChange(ctx)).toMatchObject({ ok: true });
    expect(await beginRollback(ctx)).toMatchObject({ ok: false });
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
