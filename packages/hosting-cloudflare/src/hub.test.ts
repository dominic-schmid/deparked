import { insertDomain, insertLedgerEntry } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import type { HubSetup, SetupStepReport } from "@deparked/hosting";
import { describe, expect, it } from "vitest";
import { createCloudflareHubSetup } from "./hub";
import { createMockAccount } from "./testing";

const NEW_TOKEN = "mock-new-token-never-shown";

async function world(accountId?: string) {
  const { mock, connection } = await createMockAccount({ zones: [{ id: "zone-1", name: "example.com" }] });
  const { db } = await createTestDb();
  let clock = 1_700_000_000_000;
  const hub = createCloudflareHubSetup({
    ...connection,
    ...(accountId ? { accountId } : {}),
    db,
    now: () => (clock += 1),
  });
  return { mock, db, hub };
}

async function uninstall(hub: HubSetup) {
  const reports: SetupStepReport[] = [];
  let state = { next: 0 };
  for (;;) {
    const report = await hub.uninstallStep(state);
    reports.push(report);
    state = report.state;
    if (report.finished || report.outcome === "blocked" || report.outcome === "failed") return reports;
  }
}

describe("the token's health", () => {
  it("is ok when the token works with every permission", async () => {
    const { hub } = await world();
    expect(await hub.tokenHealth()).toMatchObject({ state: "ok", missing: [] });
  });

  it("names a missing permission", async () => {
    const { hub, mock } = await world();
    mock.denyPermission("turnstile");
    const health = await hub.tokenHealth();
    expect(health.state).toBe("incomplete");
    expect(health.missing.map((gap) => gap.label)).toEqual(["Turnstile"]);
    expect(health.missing[0]?.why).not.toBe("");
  });

  it("is rejected when Cloudflare no longer accepts the token", async () => {
    const { hub, mock } = await world();
    expect(await hub.tokenAccepted()).toBe(true);
    mock.state.token = "another-token";
    expect(await hub.tokenHealth()).toEqual({ state: "rejected", missing: [], unchecked: [] });
    expect(await hub.tokenAccepted()).toBe(false);
  });
});

describe("replacing the token", () => {
  it("stores a working token of the same account as the admin's secret", async () => {
    const { hub, mock } = await world();
    mock.state.token = NEW_TOKEN;
    const result = await hub.replaceToken(NEW_TOKEN);
    expect(result).toMatchObject({ ok: true, health: { state: "ok", missing: [] } });
    const secret = mock.liveBindings("deparked-admin").find((binding) => binding.name === "CF_API_TOKEN");
    expect(secret).toMatchObject({ type: "secret_text", text: NEW_TOKEN });
    expect(JSON.stringify(result)).not.toContain(NEW_TOKEN);
  });

  it("refuses a token Cloudflare does not accept, one that lacks a permission and one of another account", async () => {
    const { hub, mock } = await world();
    expect(await hub.replaceToken(NEW_TOKEN)).toMatchObject({
      ok: false,
      message: expect.stringContaining("not accept"),
    });

    mock.state.token = NEW_TOKEN;
    mock.denyPermission("d1");
    expect(await hub.replaceToken(NEW_TOKEN)).toMatchObject({ ok: false, message: expect.stringContaining("D1") });
    mock.allowPermission("d1");

    const foreign = await world("someone-elses-account");
    foreign.mock.state.token = NEW_TOKEN;
    expect(await foreign.hub.replaceToken(NEW_TOKEN)).toMatchObject({
      ok: false,
      message: expect.stringContaining("another Cloudflare account"),
    });
    expect(mock.calls.some((call) => call.route === "workers.putSecret")).toBe(false);
    expect(foreign.mock.calls.some((call) => call.route === "workers.putSecret")).toBe(false);
  });
});

describe("uninstalling", () => {
  it("lists what goes and what stays, then deletes it one step per call, the admin last", async () => {
    const { hub, mock, db } = await world();
    await insertLedgerEntry(db, { resource: "worker", cfId: "deparked-admin", action: "created", now: 1 });
    await insertDomain(db, { domain: { host: "example.com", zoneId: "zone-1" }, now: 1 });

    const described = await hub.describeUninstall();
    expect(described.steps.at(-1)?.title).toBe("Delete the admin panel");
    expect(described.effects.map((effect) => effect.what)).toContainEqual(expect.stringContaining("deparked-admin"));
    expect(described.keeps.join(" ")).toContain("offers");

    const reports = await uninstall(hub);
    expect(reports.at(-1)?.finished).toBe(true);
    expect(reports.every((report) => report.outcome !== "failed")).toBe(true);
    expect(mock.state.scripts.has("deparked-admin")).toBe(false);
  });

  it("refuses a step whose earlier steps are not done, and deletes nothing", async () => {
    const { hub, mock, db } = await world();
    await insertLedgerEntry(db, { resource: "worker", cfId: "deparked-admin", action: "created", now: 1 });
    await insertDomain(db, { domain: { host: "example.com", zoneId: "zone-1" }, now: 1 });
    await insertLedgerEntry(db, {
      host: "example.com",
      zoneId: "zone-1",
      resource: "route",
      cfId: "route-1",
      action: "created",
      now: 1,
    });
    const { steps } = await hub.describeUninstall();

    const report = await hub.uninstallStep({ next: steps.length - 1 });
    expect(report).toMatchObject({ outcome: "blocked", finished: false, state: { next: steps.length - 1 } });
    expect(mock.state.scripts.has("deparked-admin")).toBe(true);
    expect(mock.calls.some((call) => call.method === "DELETE")).toBe(false);
  });
});
