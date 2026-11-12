import { getDomain, listLedger, listTurnstileWidgets } from "@deparked/db";
import { describe, expect, it } from "vitest";
import { planAttachDomain } from "./attach";
import { MX_EXTERNAL } from "./fixtures/mx";
import { dryRun } from "./steps";
import { mutatingCalls, runPlan, setup, ZONE, zoneSnapshot } from "./test-helpers";
import { describeRemoval, planRemoveDomain, planTurnOff } from "./turn-off";

const HOST = "example.com";

describe("turning a domain off", () => {
  it("restores exactly what the zone was before the attach", async () => {
    const { ctx, mock, db } = await setup();
    const before = zoneSnapshot(mock);
    await runPlan(planAttachDomain(ctx, HOST));
    expect(zoneSnapshot(mock)).not.toEqual(before);

    const reports = await runPlan(planTurnOff(ctx, HOST));
    expect(reports.map((report) => [report.step?.id, report.outcome])).toEqual([
      ["stop-email", "ran"],
      ["stop-analytics", "ran"],
      ["stop-bot-check", "ran"],
      ["stop-dns", "ran"],
      ["stop-rules", "ran"],
      ["stop-routes", "ran"],
      ["mark-off", "ran"],
    ]);
    for (const report of reports) expect(report.requests).toBeLessThanOrEqual(50);
    expect(zoneSnapshot(mock)).toEqual(before);

    const entries = await listLedger(db, { host: HOST });
    expect(entries).toHaveLength(11);
    expect(entries.every((entry) => entry.undoneAt !== null)).toBe(true);
    expect(await getDomain(db, HOST)).toMatchObject({
      status: "off",
      turnstileWidgetId: null,
      analyticsSiteTag: null,
      analyticsBeaconToken: null,
      emailRoutingState: "none",
      senderHost: null,
    });
    expect((await getDomain(db, HOST))?.turnedOffAt).not.toBeNull();
  });

  it("frees the place in the bot check but keeps the shared widget and its secret", async () => {
    const { ctx, mock, db } = await setup();
    await runPlan(planAttachDomain(ctx, HOST));
    await runPlan(planTurnOff(ctx, HOST));

    expect(mock.state.widgets).toMatchObject([{ name: "deparked-1", domains: [] }]);
    expect(await listTurnstileWidgets(db)).toMatchObject([{ name: "deparked-1", hostnameCount: 0 }]);
    expect(mock.liveBindings("deparked-admin").map((binding) => binding.name)).toContain("TURNSTILE_SECRET_1");
    expect(await listLedger(db, { host: null, activeOnly: true })).toHaveLength(1);
  });

  it("gives a taken-over route and replaced mail back, and leaves the owner's own things alone", async () => {
    const { ctx, cf, mock } = await setup({
      dnsRecords: {
        [ZONE.id]: [{ id: "a-apex", type: "A", name: HOST, content: "192.0.2.10", proxied: true }, ...MX_EXTERNAL],
      },
    });
    await cf.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "my-site" });
    await cf.zones.createRoute(ZONE.id, { pattern: "blog.example.com/*", script: "blog" });
    await cf.rulesets.addRule(ZONE.id, "http_request_transform", {
      action: "rewrite",
      description: "old paths",
      expression: 'starts_with(http.request.uri.path, "/old/")',
      action_parameters: { uri: { path: { value: "/new" } } },
    });
    // Restored mail records are new records at the end of the list: compare what they say, not ids or order.
    const comparable = () => {
      const snapshot = zoneSnapshot(mock);
      const dns = snapshot.dns.map(
        (record) => `${record.type} ${record.name} ${record.content} ${record.priority ?? ""}`,
      );
      return { ...snapshot, dns: dns.sort() };
    };
    const before = comparable();

    await runPlan(planAttachDomain(ctx, HOST, { repointExistingRoutes: true, replaceExistingMx: true }));
    expect(mock.state.routes.get(ZONE.id)?.[0]?.script).toBe("deparked-sites");

    const removal = await describeRemoval(ctx, HOST);
    expect(removal.effects.filter((effect) => effect.kind === "restore").map((effect) => effect.what)).toEqual([
      "Cloudflare's email service on example.com is turned off and your mail records come back (aspmx.l.google.com, alt1.aspmx.l.google.com)",
      "example.com/* goes back to my-site",
    ]);

    const reports = await runPlan(planTurnOff(ctx, HOST));
    expect(reports.at(-1)).toMatchObject({ finished: true });
    expect(comparable()).toEqual(before);
  });

  it("is safe to repeat: the second run has nothing to do and makes no mutating call", async () => {
    const { ctx, mock } = await setup();
    await runPlan(planAttachDomain(ctx, HOST));
    await runPlan(planTurnOff(ctx, HOST));
    mock.calls.length = 0;

    expect((await runPlan(planTurnOff(ctx, HOST))).map((report) => report.outcome)).toEqual(
      Array(7).fill("already-done"),
    );
    expect(await dryRun(planTurnOff(ctx, HOST))).toMatchObject({ nothingToDo: true });
    expect(mock.calls).toEqual([]);
  });

  it("finishes after a failure, and when something was already deleted by hand", async () => {
    const { ctx, cf, mock, db } = await setup();
    const before = zoneSnapshot(mock);
    await runPlan(planAttachDomain(ctx, HOST));
    const [route] = mock.state.routes.get(ZONE.id) ?? [];
    await cf.zones.deleteRoute(ZONE.id, route?.id ?? "");
    mock.failNext({ route: "rulesets.deleteRule", nth: 2, status: 403 });

    const failed = await runPlan(planTurnOff(ctx, HOST));
    expect(failed.at(-1)).toMatchObject({ outcome: "failed", step: { id: "stop-rules" } });
    const retried = await runPlan(planTurnOff(ctx, HOST));
    expect(retried.at(-1)).toMatchObject({ finished: true });
    expect(zoneSnapshot(mock)).toEqual(before);
    expect(await listLedger(db, { host: HOST, activeOnly: true })).toEqual([]);
  });

  it("turns on again with the attach plan", async () => {
    const { ctx, mock, db } = await setup();
    await runPlan(planAttachDomain(ctx, HOST));
    const attached = zoneSnapshot(mock);
    await runPlan(planTurnOff(ctx, HOST));

    const reports = await runPlan(planAttachDomain(ctx, HOST));
    expect(reports[0]).toMatchObject({ step: { id: "register" }, outcome: "already-done" });
    expect(reports.at(-1)).toMatchObject({ finished: true, next: "publish-placeholder" });
    expect(await getDomain(db, HOST)).toMatchObject({ status: "placeholder", turnedOffAt: null });
    expect(zoneSnapshot(mock).routes.map((route) => route.pattern)).toEqual(
      attached.routes.map((route) => route.pattern),
    );
    expect(await listLedger(db, { host: HOST, activeOnly: true })).toHaveLength(11);
    expect(mock.state.widgets).toHaveLength(1);
  });

  it("refuses a domain Deparked does not manage", async () => {
    const { ctx, mock } = await setup();
    const [report] = await runPlan(planTurnOff(ctx, HOST));
    expect(report).toMatchObject({ outcome: "blocked", message: "example.com is not a domain Deparked manages." });
    expect(mock.calls).toEqual([]);
  });
});

describe("removing a domain", () => {
  it("lists what will be deleted before anything happens, without a request", async () => {
    const { ctx, mock } = await setup();
    await runPlan(planAttachDomain(ctx, HOST));
    mock.calls.length = 0;

    const removal = await describeRemoval(ctx, HOST);
    expect(mock.calls).toEqual([]);
    expect(removal.effects.map((effect) => `${effect.kind}: ${effect.what}`)).toEqual([
      "remove: Cloudflare's email service on example.com",
      "remove: visitor statistics for example.com (the collected numbers are deleted)",
      "remove: example.com's place in the bot check",
      "remove: an address record Deparked added for example.com",
      "remove: an address record Deparked added for example.com",
      "remove: a rule Deparked added for example.com",
      "remove: a rule Deparked added for example.com",
      "remove: a rule Deparked added for example.com",
      "remove: a route that sends example.com to Deparked",
      "remove: a route that sends example.com to Deparked",
      "remove: a route that sends example.com to Deparked",
    ]);
    expect(removal.keeps).toContain("the offers example.com received");
  });

  it("turns the domain off and marks it removed; the row stays", async () => {
    const { ctx, mock, db } = await setup();
    const before = zoneSnapshot(mock);
    await runPlan(planAttachDomain(ctx, HOST));

    const reports = await runPlan(planRemoveDomain(ctx, HOST));
    expect(reports.at(-1)).toMatchObject({ step: { id: "mark-removed" }, outcome: "ran", finished: true });
    expect(zoneSnapshot(mock)).toEqual(before);
    expect(await getDomain(db, HOST)).toMatchObject({ status: "removed" });
    expect((await getDomain(db, HOST))?.removedAt).not.toBeNull();
    expect((await describeRemoval(ctx, HOST)).effects).toEqual([]);

    mock.calls.length = 0;
    expect((await runPlan(planRemoveDomain(ctx, HOST))).every((report) => report.outcome === "already-done")).toBe(
      true,
    );
    expect(mutatingCalls(mock)).toEqual([]);
  });
});
