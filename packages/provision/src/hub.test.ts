import { createCloudflareClient } from "@deparked/cf";
import { createMockCloudflare, type MockFailure } from "@deparked/cf/mock";
import {
  getWorkspace,
  insertLedgerEntry,
  insertTurnstileWidget,
  listLedger,
  listSiteFilesByHost,
  migrations,
  replaceSiteFiles,
} from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { describe, expect, it } from "vitest";
import type { ProvisionContext } from "./context";
import { adminUrl, issueSetupSecret, planInstallHub, planUninstall } from "./hub";
import { releaseFromUrl, sha256Hex } from "./release";
import { dryRun, PLAN_START, runNextStep } from "./steps";
import { mutatingCalls, runPlan } from "./test-helpers";
import { buildFakeRelease, FAKE_FILES } from "./test-release";

const TOKEN = "test-token-never-shown";

async function setup(options: { tamper?: boolean; pin?: string } = {}) {
  const mock = createMockCloudflare({ token: TOKEN });
  const { d1, db } = await createTestDb();
  // The Deploy button's database: the installer's binding and the API reach the same one.
  const databaseId = mock.attachDatabase("deparked", d1);
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
  const fake = await buildFakeRelease();
  if (options.tamper === true) {
    const name = "deparked-1.0.0-admin-modules.pack";
    const bytes = fake.assets.get(name) ?? new Uint8Array();
    bytes[0] = (bytes[0] ?? 0) ^ 1;
  }
  const release = () =>
    releaseFromUrl({ baseUrl: fake.baseUrl, pinnedSha256: options.pin ?? fake.sha256, fetch: fake.fetch });
  const plan = () => planInstallHub(ctx, { release: release(), token: TOKEN });
  return { mock, db, d1, cf, ctx, fake, plan, databaseId };
}

/** Each step gets a new release source, as each browser request does. */
async function install(context: Awaited<ReturnType<typeof setup>>) {
  const reports = [];
  let state = PLAN_START;
  for (;;) {
    const report = await runNextStep(context.plan(), state);
    reports.push(report);
    state = report.state;
    if (report.finished || report.outcome === "blocked" || report.outcome === "failed") return reports;
  }
}

describe("installing the hub", () => {
  it("creates both Workers, migrates, records the catalog and the ledger", async () => {
    const context = await setup();
    const { mock, db, fake, databaseId } = context;
    const reports = await install(context);

    expect(reports.map((report) => [report.step?.id, report.outcome])).toEqual([
      ["download", "ran"],
      ["migrate", "already-done"],
      ["sites", "ran"],
      ["admin", "ran"],
    ]);
    expect(reports.at(-1)?.finished).toBe(true);
    for (const report of reports) expect(report.requests).toBeLessThan(20);

    const catalog = FAKE_FILES.filter((file) => file.pack === "catalog");
    const served = mock.deployedAssets("deparked-sites");
    expect([...served.keys()].sort()).toEqual(catalog.map((file) => file.path).sort());
    expect(mock.state.scripts.get("deparked-sites")?.versions.at(-1)?.metadata.assets).toMatchObject({
      config: { html_handling: "none", not_found_handling: "none" },
    });
    const rows = await listSiteFilesByHost(db, null);
    expect(rows.map((row) => row.path).sort()).toEqual(catalog.map((file) => file.path).sort());
    const listed = fake.release.files.find((file) => file.path === "/catalog/fonts/a.woff2");
    expect(rows.find((row) => row.path === listed?.path)).toMatchObject({ hash: listed?.hash, size: listed?.size });

    const bindings = Object.fromEntries(mock.liveBindings("deparked-admin").map((binding) => [binding.name, binding]));
    expect(Object.keys(bindings).sort()).toEqual(
      ["CF_ACCOUNT_ID", "CF_API_TOKEN", "DB", "DEPARKED_RELEASE", "EMAIL", "RELEASE_FILES_URL", "SESSION_KEY"].sort(),
    );
    expect(bindings.CF_API_TOKEN).toMatchObject({ type: "secret_text", text: TOKEN });
    expect(bindings.DB).toMatchObject({ type: "d1", database_id: databaseId });
    expect(bindings.RELEASE_FILES_URL).toMatchObject({ type: "plain_text", text: fake.release.catalogFilesUrl });
    expect(mock.state.scripts.get("deparked-admin")?.subdomainEnabled).toBe(true);
    expect(mock.deployedAssets("deparked-admin").has("/admin/_assets/app.js")).toBe(true);
    expect(mock.deployedAssets("deparked-admin").has("/catalog/fonts/a.woff2")).toBe(true);
    expect(mock.state.scripts.get("deparked-admin")?.versions.at(-1)?.metadata.assets).toMatchObject({
      config: { _headers: fake.release.workers.admin.headers },
    });

    const ledger = await listLedger(db, { host: null });
    expect(ledger.map((entry) => [entry.resource, entry.cfId]).sort()).toEqual([
      ["worker", "deparked-admin"],
      ["worker", "deparked-sites"],
    ]);
    expect(await getWorkspace(db)).toMatchObject({ installedRelease: "1.0.0", cfAccountId: mock.state.accountId });
    // The API token is a Worker secret, never a database value.
    expect(JSON.stringify(await db.query.workspace.findMany())).not.toContain(TOKEN);
  });

  it("runs the release's migrations over the API on a fresh database", async () => {
    const mock = createMockCloudflare({ token: TOKEN });
    const { d1, db } = await createTestDb();
    await d1.prepare(`DELETE FROM "d1_migrations"`).run();
    mock.attachDatabase("deparked", d1);
    const cf = createCloudflareClient({
      token: TOKEN,
      accountId: mock.state.accountId,
      fetch: mock.fetch,
      baseUrl: "https://mock.test/client/v4",
    });
    const fake = await buildFakeRelease();
    const ctx: ProvisionContext = { cf, db, now: () => 1 };
    const plan = planInstallHub(ctx, {
      release: releaseFromUrl({ baseUrl: fake.baseUrl, pinnedSha256: fake.sha256, fetch: fake.fetch }),
      token: TOKEN,
    });
    const reports = await runPlan(plan);
    expect(reports[1]).toMatchObject({ outcome: "ran", effects: migrations.map(() => ({ kind: "change" })) });
    expect(mock.callsTo("d1.query").length).toBeGreaterThan(0);
  });

  it("does nothing on a second run", async () => {
    const context = await setup();
    await install(context);
    expect(await dryRun(context.plan())).toMatchObject({ nothingToDo: true, blocked: false });
    context.mock.calls.length = 0;
    const again = await install(context);
    expect(again.every((report) => report.outcome === "already-done")).toBe(true);
    expect(mutatingCalls(context.mock).filter((call) => call.route !== "d1.query")).toEqual([]);
  });

  const crashes: MockFailure[] = [
    { route: "workers.assetsUploadSession", status: 500, times: 3 },
    { route: "workers.assetsUpload", status: 500, times: 3 },
    { route: "workers.uploadScript", status: 500, times: 3, applyFirst: true },
    { route: "workers.uploadScript", nth: 2, status: 500, times: 3, applyFirst: true },
    { route: "workers.uploadScript", nth: 2, status: 500, times: 3 },
    { route: "workers.setSubdomain", status: 500 },
    { route: "workers.getSettings", nth: 3, status: 500, times: 3 },
  ];
  it.each(crashes)("finishes after a crash ($route, call $nth)", async (failure) => {
    const context = await setup();
    context.mock.failNext(failure);
    const first = await install(context);
    expect(first.at(-1)?.outcome).toBe("failed");
    const second = await install(context);
    expect(second.at(-1)).toMatchObject({ finished: true });
    expect(second.some((report) => report.outcome === "failed")).toBe(false);
    const ledger = await listLedger(context.db, { host: null, activeOnly: true });
    expect(ledger.map((entry) => entry.cfId).sort()).toEqual(["deparked-admin", "deparked-sites"]);
    expect(await dryRun(context.plan())).toMatchObject({ nothingToDo: true });
  });

  it("never overwrites a Worker of the same name that it did not create", async () => {
    const context = await setup();
    await context.cf.workers.uploadScript("deparked-sites", {
      mainModule: "index.js",
      modules: [{ name: "index.js", content: "export default {}" }],
      compatibilityDate: "2026-11-01",
    });
    const before = context.mock.state.scripts.get("deparked-sites")?.versions.length;
    const reports = await install(context);
    expect(reports.at(-1)).toMatchObject({ outcome: "blocked", step: { id: "sites" } });
    expect(reports.at(-1)?.message).toContain("Deparked did not create it");
    expect(context.mock.state.scripts.get("deparked-sites")?.versions.length).toBe(before);
    expect(await listLedger(context.db, { host: null })).toEqual([]);
  });

  it("rejects a release file that was altered, before anything is created", async () => {
    const context = await setup({ tamper: true });
    const reports = await install(context);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ outcome: "failed", step: { id: "download" } });
    expect(reports[0]?.message).toContain("deparked-1.0.0-admin-modules.pack does not match release.json");
    expect(mutatingCalls(context.mock)).toEqual([]);
    expect(context.mock.state.scripts.size).toBe(0);
  });

  it("rejects a release.json that is not the pinned one", async () => {
    const context = await setup({ pin: await sha256Hex(new TextEncoder().encode("another release")) });
    const [report] = await install(context);
    expect(report).toMatchObject({
      outcome: "failed",
      message: expect.stringContaining("not the one this installer trusts"),
    });
  });

  it("takes only the database with exactly the installer's name: the API's filter is a search", async () => {
    const context = await setup();
    const database = context.mock.state.databases[0];
    if (database !== undefined) database.name = "deparked-old";
    const reports = await install(context);
    expect(reports.at(-1)).toMatchObject({ outcome: "blocked", step: { id: "migrate" } });
  });

  it("asks for a workers.dev address when the account has none", async () => {
    const context = await setup();
    context.mock.state.workersSubdomain = null;
    const reports = await install(context);
    expect(reports.at(-1)).toMatchObject({ outcome: "blocked", step: { id: "admin" } });
    expect(context.mock.state.scripts.has("deparked-admin")).toBe(false);
  });

  it("keeps the session key on a repeat of the admin step", async () => {
    const context = await setup();
    await install(context);
    const key = context.mock.liveBindings("deparked-admin").find((binding) => binding.name === "SESSION_KEY");
    await context.ctx.db.run("UPDATE workspace SET installed_release = '0.9.0'");
    await install(context);
    expect(context.mock.liveBindings("deparked-admin").find((binding) => binding.name === "SESSION_KEY")).toEqual(key);
  });
});

describe("handing over", () => {
  it("stores only the hash of a new setup secret and names the admin's address", async () => {
    const context = await setup();
    await install(context);
    const secret = await issueSetupSecret(context.ctx);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const workspace = await getWorkspace(context.db);
    expect(workspace?.setupSecretHash).toBe(await sha256Hex(new TextEncoder().encode(secret)));
    expect(workspace?.setupSecretExpiresAt).toBeGreaterThan(1_700_000_000_000 + 23 * 60 * 60 * 1000);
    expect(await adminUrl(context.ctx)).toBe("https://deparked-admin.mock.workers.dev");
    const second = await issueSetupSecret(context.ctx);
    expect((await getWorkspace(context.db))?.setupSecretHash).toBe(await sha256Hex(new TextEncoder().encode(second)));
  });
});

describe("uninstalling", () => {
  it("removes only what the ledger names, and the installer the Deploy button created", async () => {
    const context = await setup();
    const { cf, db, mock, ctx } = context;
    await install(context);
    await cf.workers.uploadScript("deparked-install", {
      mainModule: "index.js",
      modules: [{ name: "index.js", content: "export default {}" }],
      compatibilityDate: "2026-11-01",
    });
    await cf.workers.uploadScript("owners-worker", {
      mainModule: "index.js",
      modules: [{ name: "index.js", content: "export default {}" }],
      compatibilityDate: "2026-11-01",
    });
    const mine = await cf.turnstile.create({ name: "deparked-1", domains: [] });
    await insertTurnstileWidget(db, {
      sitekey: mine.sitekey,
      name: "deparked-1",
      secretName: "TURNSTILE_SECRET_1",
      now: 1,
    });
    await insertLedgerEntry(db, { resource: "secret", cfId: "TURNSTILE_SECRET_1", action: "created", now: 2 });
    const owners = await cf.turnstile.create({ name: "owners-widget", domains: [] });
    await replaceSiteFiles(db, { host: null, files: [], now: 3 });

    const plan = await planUninstall(ctx);
    const reports = await runPlan(plan);
    expect(reports.at(-1)?.finished).toBe(true);
    expect([...mock.state.scripts.keys()]).toEqual(["owners-worker"]);
    expect(mock.state.widgets.map((widget) => widget.sitekey)).toEqual([owners.sitekey]);
    expect(await listLedger(db, { host: null, activeOnly: true })).toEqual([]);
    expect(await dryRun(await planUninstall(ctx))).toMatchObject({ nothingToDo: true });
    // The admin is deleted last: run from the admin, its own deletion is the final call.
    expect(mutatingCalls(mock).at(-1)).toMatchObject({
      route: "workers.deleteScript",
      path: expect.stringContaining("deparked-admin"),
    });
  });

  it("records the admin's removal before deleting it, so the final call has nothing left to write", async () => {
    const context = await setup();
    const { db, mock, ctx } = context;
    await install(context);
    // Sites is deleted first, then the admin: its delete answers 500, as a lost answer would look.
    mock.failNext({ route: "workers.deleteScript", nth: 2, times: 3, status: 500 });
    const reports = await runPlan(await planUninstall(ctx));
    expect(reports.at(-1)).toMatchObject({ outcome: "failed", step: { id: "remove-admin" } });
    expect(await listLedger(db, { host: null, activeOnly: true })).toEqual([]);
    expect(mock.state.scripts.has("deparked-admin")).toBe(true);

    // Retry: the ledger says undone, but the Worker is still there, so the step still deletes it.
    const retry = await runPlan(await planUninstall(ctx));
    expect(retry.at(-1)).toMatchObject({ finished: true });
    expect(mock.state.scripts.has("deparked-admin")).toBe(false);
  });
});
