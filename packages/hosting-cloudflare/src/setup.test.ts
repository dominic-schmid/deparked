import { createCloudflareClient } from "@deparked/cf";
import { replaceSiteFiles } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import type { DomainSetup, SetupChange, SetupConfirmations, SetupStepReport } from "@deparked/hosting";
import { describe, expect, it } from "vitest";
import { createCloudflareDomainSetup } from "./setup";
import { createMockAccount } from "./testing";

const HOST = "example.com";
const ZONE = { id: "zone-1", name: HOST };

async function world(seed: Parameters<typeof createMockAccount>[0] = { zones: [ZONE] }) {
  const { mock, connection } = await createMockAccount(seed);
  const { db } = await createTestDb();
  let clock = 1_700_000_000_000;
  const now = () => (clock += 1);
  const published: string[] = [];
  const setup = createCloudflareDomainSetup({
    ...connection,
    db,
    now,
    async publishPlaceholder(host) {
      published.push(host);
      const file = { path: `/sites/${host}/index.html`, hash: "0".repeat(32), size: 1, contentType: "text/html" };
      await replaceSiteFiles(db, { host, files: [file], now: now() });
    },
  });
  return { mock, db, setup, published, connection };
}

async function run(setup: DomainSetup, change: SetupChange, confirmations: SetupConfirmations = {}) {
  const reports: SetupStepReport[] = [];
  let state = { next: 0 };
  for (;;) {
    const report = await setup.step(change, HOST, state, confirmations);
    reports.push(report);
    state = report.state;
    if (report.finished || report.outcome === "blocked" || report.outcome === "failed") return reports;
  }
}

describe("listing the account's domains", () => {
  const zones = Array.from({ length: 130 }, (_, index) => ({
    id: `zone-${index}`,
    name: `d${String(index).padStart(3, "0")}.test`,
  }));

  it("pages by name, leaves out managed domains and stays within four requests", async () => {
    const { setup, mock } = await world({ zones });
    const first = await setup.listAccountDomains({ exclude: new Set(["d000.test"]) });
    expect(first.domains).toHaveLength(49);
    expect(first.domains[0]).toEqual({ id: "zone-1", name: "d001.test", active: true });
    expect(first.nextPage).toBe(2);
    const last = await setup.listAccountDomains({ page: 3 });
    expect(last).toMatchObject({ domains: { length: 30 }, nextPage: null });
    expect(mock.callsTo("zones.list")).toHaveLength(2);
  });

  it("fills a page from several requests when most names are taken, and searches by part of the name", async () => {
    const { setup, mock } = await world({ zones });
    const exclude = new Set(zones.slice(0, 120).map((zone) => zone.name));
    expect(await setup.listAccountDomains({ exclude })).toMatchObject({ domains: { length: 10 }, nextPage: null });
    expect(mock.callsTo("zones.list")).toHaveLength(3);
    const found = await setup.listAccountDomains({ search: "d12" });
    expect(found.domains.map((domain) => domain.name)).toEqual(
      Array.from({ length: 10 }, (_, index) => `d12${index}.test`),
    );
  });

  it("names a rejected token", async () => {
    const { setup, mock } = await world({ zones });
    mock.failNext({ route: "zones.list", status: 403 });
    await expect(setup.listAccountDomains({})).rejects.toMatchObject({ code: "credentials-rejected" });
  });
});

describe("looking at a domain before attaching", () => {
  it("asks only for what this domain needs, and only reads", async () => {
    const { setup, mock } = await world({
      zones: [ZONE],
      dnsRecords: {
        [ZONE.id]: [
          { id: "a", type: "A", name: HOST, content: "192.0.2.10", proxied: true },
          { id: "mx", type: "MX", name: HOST, content: "aspmx.l.google.com", priority: 1 },
        ],
      },
    });
    expect(await setup.inspect(HOST)).toMatchObject({
      inAccount: true,
      asks: ["takeOverLiveSite", "replaceExistingMx"],
      servesWebsite: true,
      mail: "external",
      mailServers: ["aspmx.l.google.com"],
      blockers: [],
    });
    expect(await setup.previewStep(HOST, "register", {})).toMatchObject({ status: "blocked", effects: [] });
    expect(await setup.previewStep(HOST, "register", { takeOverLiveSite: true })).toMatchObject({
      status: "needed",
      reason: "",
    });
    expect(mock.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("previews every step of the attach, and nothing is left to do after it ran", async () => {
    const { setup } = await world();
    const ids = setup.stepTitles("attach", HOST).map((step) => step.id);
    const before = await Promise.all(ids.map((id) => setup.previewStep(HOST, id, {})));
    expect(before.map((step) => step.id)).toEqual(ids);
    expect(before.some((step) => step.status === "needed")).toBe(true);

    expect((await run(setup, "attach")).at(-1)).toMatchObject({ finished: true });
    const after = await Promise.all(ids.map((id) => setup.previewStep(HOST, id, {})));
    expect(after.map((step) => step.status)).toEqual(ids.map(() => "done"));
  });

  it("still offers to move the mail of a domain added with its own mail kept", async () => {
    const { setup } = await world({
      zones: [ZONE],
      dnsRecords: { [ZONE.id]: [{ id: "mx", type: "MX", name: HOST, content: "aspmx.l.google.com", priority: 1 }] },
    });
    expect((await run(setup, "attach")).at(-1)).toMatchObject({ finished: true });

    expect(await setup.inspect(HOST)).toMatchObject({ asks: ["replaceExistingMx"] });
    expect(await setup.previewStep(HOST, "email", {})).toMatchObject({ status: "done" });
    expect(await setup.previewStep(HOST, "email", { replaceExistingMx: true })).toMatchObject({ status: "needed" });
  });

  it("keeps each question far under the 50 subrequests of one request on a large zone", async () => {
    const records = [
      ...Array.from({ length: 450 }, (_, index) => ({
        id: `t${index}`,
        type: "TXT",
        name: HOST,
        content: `v${index}`,
      })),
      ...Array.from({ length: 300 }, (_, index) => ({
        id: `s${index}`,
        type: "A",
        name: `s${index}.${HOST}`,
        content: "192.0.2.1",
        proxied: true,
      })),
      { id: "a", type: "A", name: HOST, content: "192.0.2.10", proxied: true },
      { id: "w", type: "CNAME", name: `www.${HOST}`, content: HOST, proxied: true },
      { id: "mx", type: "MX", name: HOST, content: "aspmx.l.google.com", priority: 1 },
    ];
    const { setup, mock, connection } = await world({ zones: [ZONE], dnsRecords: { [ZONE.id]: records } });
    const cf = createCloudflareClient(connection);
    for (let index = 0; index < 150; index += 1) {
      await cf.zones.createRoute(ZONE.id, { pattern: `s${index}.${HOST}/*`, script: `site-${index}` });
    }
    const requests = async (question: () => Promise<unknown>) => {
      mock.calls.length = 0;
      await question();
      return mock.calls.length;
    };
    expect((await setup.inspect(HOST)).servesWebsite).toBe(true);
    const counts = [await requests(() => setup.inspect(HOST))];
    for (const { id } of setup.stepTitles("attach", HOST)) {
      counts.push(await requests(() => setup.previewStep(HOST, id, { takeOverLiveSite: true })));
    }
    expect(Math.max(...counts)).toBeLessThan(25);
  });

  it("explains a domain that is not in the account", async () => {
    const { setup } = await world();
    const today = await setup.inspect("example.net");
    expect(today).toMatchObject({ inAccount: false, asks: [] });
    expect(today.blockers[0]).toContain("not in this Cloudflare account");
  });

  it("refuses a step the attach does not have", async () => {
    const { setup } = await world();
    await expect(setup.previewStep(HOST, "no-such-step", {})).rejects.toMatchObject({ code: "invalid-input" });
  });
});

describe("steps", () => {
  it("attaches, then turns off to the zone as it was", async () => {
    const { setup, mock, published } = await world();
    const attach = await run(setup, "attach");
    expect(attach.at(-1)).toMatchObject({ finished: true, outcome: "ran" });
    expect(published).toEqual([HOST]);
    expect(mock.state.routes.get(ZONE.id)?.length).toBeGreaterThan(0);

    const off = await run(setup, "turn-off");
    expect(off.at(-1)).toMatchObject({ finished: true });
    expect(mock.state.routes.get(ZONE.id) ?? []).toEqual([]);
    expect(setup.stepTitles("turn-off", HOST).length).toBe(off.length);
  });

  it("says when Cloudflare refused the token", async () => {
    const { setup, mock } = await world();
    mock.failNext({ route: "zones.list", status: 401 });
    const [report] = await run(setup, "attach");
    expect(report).toMatchObject({ outcome: "failed", credentialsRejected: true });

    mock.failNext({ route: "zones.list", status: 400 });
    const [again] = await run(setup, "attach");
    expect(again).toMatchObject({ outcome: "failed", credentialsRejected: false });
  });
});
