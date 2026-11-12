// What keeps provisioning safe when calls overlap, when the browser sends any step index, and when Cloudflare
// answers in a way the happy path does not expect.
import { acquireProvisionLock, listLedger, replaceSiteFiles } from "@deparked/db";
import { describe, expect, it } from "vitest";
import { planAttachDomain } from "./attach";
import { BUSY_MESSAGE, dryRun, PLAN_START, type Plan, runNextStep } from "./steps";
import { mutatingCalls, runPlan, seedWidget, setup, ZONE } from "./test-helpers";
import { planTurnOff } from "./turn-off";
import { pathExclusions, sameRule, wantedRedirectRules, wantedRewriteRules } from "./wanted";

const HOST = "example.com";

function runStep(plan: Plan, id: string) {
  return runNextStep(plan, { next: plan.steps.findIndex((step) => step.id === id) });
}

describe("one provisioning change at a time", () => {
  it("answers busy, touches nothing and keeps its place while another step holds the lock", async () => {
    const { ctx, db, mock } = await setup();
    expect(await acquireProvisionLock(db, { holder: 7, ttlMs: 60_000, now: ctx.now() })).toBe(true);

    const report = await runNextStep(planAttachDomain(ctx, HOST), PLAN_START);
    expect(report).toMatchObject({ outcome: "busy", message: BUSY_MESSAGE, state: PLAN_START, requests: 0 });
    expect(mock.calls).toEqual([]);
  });

  it("two attaches with no free bot check place create one new widget and store its secret once", async () => {
    const context = await setup({ zones: [ZONE, { id: "zone-2", name: "example.org" }] });
    const { ctx, mock } = context;
    await seedWidget(context, 10);
    const plans = [planAttachDomain(ctx, HOST), planAttachDomain(ctx, "example.org")];
    for (const plan of plans) await runNextStep(plan, PLAN_START);

    const reports = await Promise.all(plans.map((plan) => runStep(plan, "bot-check")));
    expect(reports.map((report) => report.outcome).toSorted()).toEqual(["busy", "ran"]);
    for (const plan of plans) await runStep(plan, "bot-check");

    expect(mock.state.widgets).toHaveLength(2);
    expect(mock.state.widgets[1]).toMatchObject({ name: "deparked-2", domains: [HOST, "example.org"] });
    expect(mock.callsTo("workers.putSecret")).toHaveLength(1);
    expect(await listLedger(context.db, { host: null })).toMatchObject([
      { resource: "secret", cfId: "TURNSTILE_SECRET_2" },
    ]);
  });
});

describe("the bot check is checked against Cloudflare", () => {
  it("is not done while the host is missing from the widget's hostname list, and the step puts it back", async () => {
    const context = await setup();
    const { ctx, mock } = context;
    await seedWidget(context, 3);
    await runPlan(planAttachDomain(ctx, HOST));
    const widget = mock.state.widgets[0];
    if (widget === undefined) throw new Error("no widget");
    widget.domains = widget.domains.filter((name) => name !== HOST);

    const plan = planAttachDomain(ctx, HOST);
    expect((await dryRun(plan)).steps.find((step) => step.id === "bot-check")).toMatchObject({ status: "needed" });
    expect(await runStep(plan, "bot-check")).toMatchObject({ outcome: "ran" });
    expect(widget.domains).toContain(HOST);
  });

  it("reads the list again after writing it and writes once more when the host is still missing", async () => {
    const context = await setup();
    const { ctx, mock, cf } = context;
    await seedWidget(context, 3);
    const plan = planAttachDomain(ctx, HOST);
    await runNextStep(plan, PLAN_START);
    // The first write is overtaken by another one that does not know the host.
    const update = cf.turnstile.updateHostnames.bind(cf.turnstile);
    let lost = false;
    cf.turnstile.updateHostnames = async (widget, domains) => {
      if (lost) return update(widget, domains);
      lost = true;
      return update(
        widget,
        domains.filter((name) => name !== HOST),
      );
    };

    expect(await runStep(plan, "bot-check")).toMatchObject({ outcome: "ran" });
    expect(mock.state.widgets[0]?.domains).toContain(HOST);
  });
});

describe("a create Cloudflare refused", () => {
  it("withdraws its announcement, so a look-alike made later stays the owner's", async () => {
    const { ctx, mock, db, cf } = await setup();
    const plan = planAttachDomain(ctx, HOST);
    mock.failNext({ route: "routes.create", status: 400 });
    let report = await runNextStep(plan, PLAN_START);
    while (report.outcome !== "failed") report = await runNextStep(plan, report.state);
    expect(report.step?.id).toBe("routes");
    const routes = (await listLedger(db, { host: HOST })).filter((entry) => entry.resource === "route");
    expect(routes).toMatchObject([{ cfId: null }]);
    expect(routes[0]?.undoneAt).not.toBeNull();

    const theirs = await cf.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "deparked-sites" });
    expect(await runNextStep(plan, report.state)).toMatchObject({ outcome: "ran" });
    const active = await listLedger(db, { host: HOST, activeOnly: true });
    expect(active.some((entry) => entry.cfId === theirs.id)).toBe(false);
  });

  it("keeps the announcement when the outcome is unknown", async () => {
    const { ctx, mock, db } = await setup();
    const plan = planAttachDomain(ctx, HOST);
    mock.failNext({ route: "routes.create", status: 502 });
    let report = await runNextStep(plan, PLAN_START);
    while (report.outcome !== "failed") report = await runNextStep(plan, report.state);
    expect(await listLedger(db, { host: HOST, activeOnly: true })).toContainEqual(
      expect.objectContaining({ resource: "route", cfId: null }),
    );
  });
});

describe("rules as Cloudflare stores them", () => {
  const [pages] = wantedRewriteRules(HOST, []);
  const [www] = wantedRedirectRules(HOST);
  if (pages === undefined || www === undefined) throw new Error("no rule");

  it("are the same rule with other whitespace and with default keys Cloudflare added", () => {
    expect(
      sameRule(
        {
          ...pages,
          expression: `${pages.expression.replace(" and ", "\n  and  ").replace("(http.host", "( http.host")} `,
          action_parameters: { uri: { path: pages.action_parameters.uri.path, origin: false } },
        },
        pages,
      ),
    ).toBe(true);
    expect(
      sameRule(
        {
          ...www,
          action_parameters: { from_value: { ...www.action_parameters.from_value, preserve_query_string: true } },
        },
        www,
      ),
    ).toBe(true);
  });

  it("are another rule when what Deparked sets differs, even only inside a quoted value", () => {
    expect(sameRule({ ...pages, expression: pages.expression.replace(`"${HOST}"`, `"${HOST} "`) }, pages)).toBe(false);
    expect(
      sameRule(
        { ...www, action_parameters: { from_value: { ...www.action_parameters.from_value, status_code: 302 } } },
        www,
      ),
    ).toBe(false);
    expect(sameRule({ ...pages, action_parameters: { uri: { path: { value: "/" } } } }, pages)).toBe(false);
  });
});

describe("steps that send visitors to Deparked check their own gates", () => {
  const visitorSteps = ["routes", "rewrite", "www-redirect"];

  it("refuse to run before the placeholder page is published, whatever step index arrives", async () => {
    const { ctx, mock } = await setup();
    const plan = planAttachDomain(ctx, HOST);
    await runNextStep(plan, PLAN_START);
    for (const id of visitorSteps) {
      expect(await runStep(plan, id)).toMatchObject({ outcome: "blocked" });
    }
    expect(mutatingCalls(mock)).toEqual([]);
  });

  it("refuse to take over a live site that was not confirmed", async () => {
    const { ctx, mock, db } = await setup({
      dnsRecords: { [ZONE.id]: [{ id: "a-apex", type: "A", name: HOST, content: "192.0.2.10", proxied: true }] },
    });
    await runNextStep(planAttachDomain(ctx, HOST, { takeOverLiveSite: true }), PLAN_START);
    const file = { path: `/sites/${HOST}/index.html`, hash: "0".repeat(32), size: 1, contentType: "text/html" };
    await replaceSiteFiles(db, { host: HOST, files: [file], now: ctx.now() });
    mock.calls.length = 0;

    const plan = planAttachDomain(ctx, HOST);
    for (const id of visitorSteps) {
      expect(await runStep(plan, id)).toMatchObject({ outcome: "blocked" });
    }
    expect(mutatingCalls(mock)).toEqual([]);
  });
});

describe("turn off always finishes", () => {
  it("when the zone or its features are gone", async () => {
    const { ctx, mock, db } = await setup();
    await runPlan(planAttachDomain(ctx, HOST));
    for (const route of [
      "email.getRouting",
      "email.disableRouting",
      "dns.list",
      "routes.list",
      "rulesets.getEntrypoint",
    ]) {
      mock.failNext({ route, status: 404, times: 20 });
    }

    const reports = await runPlan(planTurnOff(ctx, HOST));
    expect(reports.at(-1)).toMatchObject({ finished: true });
    expect(await listLedger(db, { host: HOST, activeOnly: true })).toEqual([]);
  });

  it("says that a resource whose create was cut off may still exist, and names it", async () => {
    const { ctx, mock, db } = await setup();
    const plan = planAttachDomain(ctx, HOST);
    mock.failNext({ route: "routes.create", status: 502 });
    let report = await runNextStep(plan, PLAN_START);
    while (report.outcome !== "failed") report = await runNextStep(plan, report.state);

    const reports = await runPlan(planTurnOff(ctx, HOST));
    expect(reports.at(-1)).toMatchObject({ finished: true });
    const note = reports
      .find((entry) => entry.step?.id === "stop-routes")
      ?.effects.find((effect) => effect.what.includes("may still exist"));
    expect(note?.what).toContain("example.com/*");
    expect(await listLedger(db, { host: HOST, activeOnly: true })).toEqual([]);
  });

  it("leaves a route that now goes to the other Deparked Worker", async () => {
    const { ctx, cf, mock } = await setup();
    await runPlan(planAttachDomain(ctx, HOST));
    const admin = mock.state.routes.get(ZONE.id)?.find((route) => route.pattern === "example.com/admin*");
    if (admin === undefined) throw new Error("no route");
    await cf.zones.updateRoute(ZONE.id, admin.id, { pattern: admin.pattern, script: "deparked-sites" });

    const reports = await runPlan(planTurnOff(ctx, HOST));
    expect(reports.find((entry) => entry.step?.id === "stop-routes")?.effects).toContainEqual({
      kind: "reuse",
      what: "left as is: example.com/admin* was changed after Deparked set it",
    });
    expect(mock.state.routes.get(ZONE.id)).toEqual([{ ...admin, script: "deparked-sites" }]);
  });
});

describe("the owner's paths in the rewrite", () => {
  it("are compared without regard to case", () => {
    const { exclusions } = pathExclusions(
      [
        { id: "r1", pattern: "example.com/Shop*", script: "shop" },
        { id: "r2", pattern: "example.com/Health", script: "health" },
      ],
      HOST,
    );
    const [pages] = wantedRewriteRules(HOST, exclusions);
    expect(pages?.expression).toContain('and not starts_with(lower(http.request.uri.path), "/shop")');
    expect(pages?.expression).toContain('and lower(http.request.uri.path) ne "/health"');
  });
});
