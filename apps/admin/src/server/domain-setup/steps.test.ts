import {
  acquireProvisionLock,
  acquirePublishLock,
  type Db,
  getDomain,
  insertDeployment,
  listSiteFilesByHost,
  replaceSiteFiles,
  saveDraft,
} from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { contentHash, type SetupConfirmations } from "@deparked/hosting";
import { createFakeHosting, type FakeHosting } from "@deparked/hosting/testing";
import { createCloudflareDomainSetup } from "@deparked/hosting-cloudflare";
import { createMockAccount } from "@deparked/hosting-cloudflare/testing";
import { catalog } from "@deparked/templates/catalog";
import { beforeEach, describe, expect, it } from "vitest";
import type { PublishContext } from "../publish/pipeline";
import {
  attachStep,
  domainName,
  listAccountDomains,
  listSteps,
  placeholderPublisher,
  previewAttach,
  type SetupDeps,
  type StepView,
  takeOffStep,
} from "./steps";

const HOST = "example.com";
const ZONE = { id: "zone-1", name: HOST };
const FONT = "/catalog/fonts/a.woff2";
const FONT_BYTES = new TextEncoder().encode("font bytes");
const LIVE_SITE = {
  zones: [ZONE, { id: "zone-2", name: "example.org" }],
  dnsRecords: { [ZONE.id]: [{ id: "a", type: "A", name: HOST, content: "192.0.2.10", proxied: true }] },
};

let db: Db;
let hosting: FakeHosting;
let mock: Awaited<ReturnType<typeof createMockAccount>>["mock"];
let deps: SetupDeps;
let clock: number;
const now = () => (clock += 1000);

async function arrange(seed: Parameters<typeof createMockAccount>[0] = { zones: [ZONE] }, batchSize = 50) {
  ({ db } = await createTestDb());
  clock = 1_800_000_000_000;
  hosting = createFakeHosting({ batchSize });
  const publish: PublishContext = {
    db,
    hosting,
    now,
    catalog,
    headers: "",
    release: null,
    fetchReleaseFile: async () => FONT_BYTES,
    maxUploadBatches: 1,
  };
  const account = await createMockAccount(seed);
  mock = account.mock;
  const setup = createCloudflareDomainSetup({
    ...account.connection,
    db,
    now,
    publishPlaceholder: placeholderPublisher(publish),
  });
  deps = { db, setup, publish };
  // Every install has the shared catalog in its manifest, so taking the last domain down still publishes files.
  const font = {
    path: FONT,
    hash: await contentHash(FONT, FONT_BYTES),
    size: FONT_BYTES.length,
    contentType: "font/woff2",
  };
  await replaceSiteFiles(db, { host: null, files: [font], now: clock });
}

beforeEach(() => arrange());

type Change = "attach" | "turn-off" | "remove";

/** Drives a change the way the browser does, up to `limit` calls, until it finishes, blocks or fails. */
async function drive(change: Change, confirmations: SetupConfirmations = {}, limit = 30): Promise<StepView[]> {
  const views: StepView[] = [];
  let state = { next: 0 };
  for (let call = 0; call < limit; call += 1) {
    const view =
      change === "attach"
        ? await attachStep(deps, { host: HOST, confirmations, state })
        : await takeOffStep(deps, { change, host: HOST, state });
    views.push(view);
    state = view.state;
    if (view.finished || view.outcome === "blocked" || view.outcome === "failed" || view.outcome === "busy") break;
  }
  return views;
}

const livePaths = () => hosting.liveFiles().map((file) => file.path);
const zoneRoutes = () => structuredClone(mock.state.routes.get(ZONE.id) ?? []);

describe("adding a domain", () => {
  it("runs every step to the end and publishes the placeholder before anything points at it", async () => {
    const views = await drive("attach");

    expect(views.at(-1)).toMatchObject({ finished: true, outcome: "ran", step: { id: "ready" } });
    expect(views.every((view) => view.outcome === "ran" || view.outcome === "working")).toBe(true);
    expect(livePaths()).toContain(`/sites/${HOST}/index.html`);
    expect(await listSiteFilesByHost(db, HOST)).toHaveLength(3);
    expect((await getDomain(db, HOST))?.status).toBe("placeholder");
    expect(zoneRoutes().length).toBeGreaterThan(0);
  });

  it("a publish that needs several requests answers `working` and continues where it stopped", async () => {
    await arrange({ zones: [ZONE] }, 1);
    const views = await drive("attach");

    const publishing = views.filter((view) => view.step?.id === "publish-placeholder");
    expect(publishing.length).toBeGreaterThan(2);
    expect(
      publishing.slice(0, -1).every((view) => view.outcome === "working" && view.state.next === view.step?.index),
    ).toBe(true);
    expect(publishing.at(-1)?.outcome).toBe("ran");
    expect(views.at(-1)?.finished).toBe(true);
    expect(hosting.versions).toHaveLength(1);
  });

  it("stops before any change on a domain that serves a site, until the owner confirms", async () => {
    await arrange(LIVE_SITE);
    const blocked = await drive("attach");

    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ outcome: "blocked", state: { next: 0 }, step: { id: "register" } });
    expect(blocked[0]?.message).toContain("shows a website today");
    expect(mock.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(await getDomain(db, HOST)).toBeUndefined();

    expect((await drive("attach", { takeOverLiveSite: true })).at(-1)).toMatchObject({ finished: true });
  });

  it("a forged state cannot skip the placeholder: the routes step refuses", async () => {
    const routesIndex = listSteps(deps, "attach", HOST).findIndex((step) => step.id === "routes");
    const view = await attachStep(deps, { host: HOST, confirmations: {}, state: { next: routesIndex } });
    expect(view.outcome).toBe("blocked");
    expect(zoneRoutes()).toEqual([]);
  });

  it("is busy while another change to the domains runs, and changes nothing", async () => {
    await acquireProvisionLock(db, { holder: 7, ttlMs: 120_000, now: clock });
    const [view] = await drive("attach");
    expect(view).toMatchObject({ outcome: "busy", state: { next: 0 }, finished: false });
    expect(mock.calls).toEqual([]);
  });

  it("is busy while another domain's publish runs, then publishes once it is free", async () => {
    const other = await insertDeployment(db, { worker: "sites", kind: "update", now: clock });
    await acquirePublishLock(db, { deploymentId: other.id, ttlMs: 60_000, now: clock });
    const views = await drive("attach");
    expect(views.at(-1)).toMatchObject({ outcome: "busy", step: { id: "publish-placeholder" } });

    clock += 120_000;
    const state = views.at(-1)?.state ?? { next: 0 };
    expect(await attachStep(deps, { host: HOST, confirmations: {}, state })).toMatchObject({ outcome: "ran" });
  });

  it("says when the token is rejected", async () => {
    mock.failNext({ route: "zones.list", status: 403 });
    const [view] = await drive("attach");
    expect(view).toMatchObject({ outcome: "failed", credentialsRejected: true, state: { next: 0 } });
  });

  it("lists the account's domains without the managed ones, and previews in plain words", async () => {
    await arrange(LIVE_SITE);
    await drive("attach", { takeOverLiveSite: true });
    expect(await listAccountDomains(deps, { search: "", page: 1 })).toEqual({
      domains: [{ id: "zone-2", name: "example.org", active: true }],
      nextPage: null,
    });
    const preview = await previewAttach(deps, { host: "example.org", confirmations: {} });
    expect(preview).toMatchObject({ inAccount: true, asks: [], blockers: [] });
    expect(preview.summary).toContain("example.org shows nothing today");
  });
});

describe("turning a domain off and removing it", () => {
  it("turn off restores the zone, then takes the pages offline; the design stays", async () => {
    const before = zoneRoutes();
    await drive("attach");
    await saveDraft(db, { host: HOST, json: "{}", schemaVersion: 1, now: clock });

    const views = await drive("turn-off");

    expect(views.at(-1)).toMatchObject({ finished: true, outcome: "ran", step: { id: "take-down" } });
    expect(views.at(-1)?.step?.total).toBe(listSteps(deps, "turn-off", HOST).length);
    expect(zoneRoutes()).toEqual(before);
    expect(livePaths().some((path) => path.startsWith(`/sites/${HOST}/`))).toBe(false);
    expect(await listSiteFilesByHost(db, HOST)).toEqual([]);
    expect((await getDomain(db, HOST))?.status).toBe("off");

    const again = await drive("turn-off");
    expect(again.every((view) => view.outcome === "already-done")).toBe(true);
  });

  it("turning on again is the attach: the page is back", async () => {
    await drive("attach");
    await drive("turn-off");
    expect((await drive("attach")).at(-1)).toMatchObject({ finished: true });
    expect(livePaths()).toContain(`/sites/${HOST}/index.html`);
    expect((await getDomain(db, HOST))?.status).toBe("placeholder");
  });

  it("remove takes the pages down and marks the domain removed, so it can be picked again", async () => {
    await drive("attach");
    const views = await drive("remove");

    expect(views.at(-1)).toMatchObject({ finished: true, step: { id: "take-down" } });
    expect(views.map((view) => view.step?.id)).toContain("mark-removed");
    expect((await getDomain(db, HOST))?.status).toBe("removed");
    expect(await listSiteFilesByHost(db, HOST)).toEqual([]);
    expect(livePaths()).toEqual([FONT]);
    expect((await listAccountDomains(deps, { search: "exa", page: 1 })).domains.map((d) => d.name)).toEqual([HOST]);
  });

  it("refuses a domain Deparked does not manage", async () => {
    expect(await takeOffStep(deps, { change: "turn-off", host: HOST, state: { next: 0 } })).toMatchObject({
      outcome: "blocked",
      message: `${HOST} is not a domain Deparked manages.`,
    });
  });

  it("does not take the pages down while an attach is half-way, or while a step holds the lock", async () => {
    const attach = listSteps(deps, "attach", HOST).findIndex((step) => step.id === "routes");
    let state = { next: 0 };
    while (state.next < attach) state = (await attachStep(deps, { host: HOST, confirmations: {}, state })).state;
    const takeDown = { next: listSteps(deps, "turn-off", HOST).length - 1 };

    const view = await takeOffStep(deps, { change: "turn-off", host: HOST, state: takeDown });
    expect(view).toMatchObject({ outcome: "blocked", state: takeDown });
    expect(view.message).toContain("stopped half-way");
    expect(livePaths()).toContain(`/sites/${HOST}/index.html`);

    await drive("turn-off");
    await drive("attach");
    expect(await takeOffStep(deps, { change: "turn-off", host: HOST, state: takeDown })).toMatchObject({
      outcome: "blocked",
      message: `${HOST} was turned on again, so its pages stay.`,
    });
    await acquireProvisionLock(db, { holder: 9, ttlMs: 120_000, now: clock });
    expect(await takeOffStep(deps, { change: "turn-off", host: HOST, state: takeDown })).toMatchObject({
      outcome: "busy",
    });
  });

  it("turn on after a turn off that stopped before the take-down publishes the page again", async () => {
    await drive("attach");
    const turnOff = listSteps(deps, "turn-off", HOST);
    let state = { next: 0 };
    while (state.next < turnOff.length - 1) {
      state = (await takeOffStep(deps, { change: "turn-off", host: HOST, state })).state;
    }
    // The rows are still there, but the live version lacks the page (it went out in a deploy D1 never recorded).
    expect(await listSiteFilesByHost(db, HOST)).toHaveLength(3);
    const font = {
      path: FONT,
      hash: await contentHash(FONT, FONT_BYTES),
      size: FONT_BYTES.length,
      contentType: "font/woff2",
    };
    await hosting.publish({ files: [font], getContent: async () => FONT_BYTES });
    expect(livePaths()).toEqual([FONT]);

    const views = await drive("attach");
    expect(views.find((view) => view.step?.id === "publish-placeholder")).toMatchObject({ outcome: "ran" });
    expect(views.at(-1)).toMatchObject({ finished: true });
    expect(livePaths()).toContain(`/sites/${HOST}/index.html`);
  });

  it("a state past the end is finished", async () => {
    await drive("attach");
    const total = listSteps(deps, "turn-off", HOST).length;
    expect(await takeOffStep(deps, { change: "turn-off", host: HOST, state: { next: total + 1 } })).toMatchObject({
      outcome: "finished",
      finished: true,
    });
  });
});

describe("domain names", () => {
  it("accepts a plain domain and refuses anything that could reach a path or a rule", () => {
    expect(domainName.parse(" Example.COM. ")).toBe("example.com");
    for (const bad of ["example", "a/b.com", "exa mple.com", "*.example.com", "example.com/admin", "-a.com"]) {
      expect(domainName.safeParse(bad).success).toBe(false);
    }
  });
});
