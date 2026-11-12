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
  return { mock, db, setup, published };
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

describe("previewing an attach", () => {
  it("asks only for what this domain needs, in one request budget", async () => {
    const { setup, mock } = await world({
      zones: [ZONE],
      dnsRecords: {
        [ZONE.id]: [
          { id: "a", type: "A", name: HOST, content: "192.0.2.10", proxied: true },
          { id: "mx", type: "MX", name: HOST, content: "aspmx.l.google.com", priority: 1 },
        ],
      },
    });
    const preview = await setup.preview(HOST, {});
    expect(preview).toMatchObject({
      inAccount: true,
      asks: ["takeOverLiveSite", "replaceExistingMx"],
      servesWebsite: true,
      mail: "external",
      mailServers: ["aspmx.l.google.com"],
      blockers: [],
      nothingToDo: false,
    });
    expect(preview.steps.find((step) => step.id === "register")).toMatchObject({ status: "blocked" });
    expect(mock.calls.length).toBeLessThan(45);
    expect(mock.calls.every((call) => call.method === "GET")).toBe(true);

    const confirmed = await setup.preview(HOST, { takeOverLiveSite: true });
    expect(confirmed.steps.find((step) => step.id === "register")).toMatchObject({ status: "needed" });
  });

  it("explains a domain that is not in the account", async () => {
    const { setup } = await world();
    const preview = await setup.preview("example.net", {});
    expect(preview).toMatchObject({ inAccount: false, asks: [] });
    expect(preview.blockers[0]).toContain("not in this Cloudflare account");
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
