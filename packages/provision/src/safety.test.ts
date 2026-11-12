// Attaching and turning off must never harm what a domain already has. Each test here seeds something of the
// owner's, or breaks a call at the worst moment, and checks what is left.
import { getDomain, insertLedgerEntry, listLedger, listTurnstileWidgets } from "@deparked/db";
import { describe, expect, it } from "vitest";
import { planAttachDomain } from "./attach";
import { MX_EXTERNAL } from "./fixtures/mx";
import { inspectDomain } from "./inspect";
import { BUSY_MESSAGE, dryRun, PLAN_START, runNextStep } from "./steps";
import { mutatingCalls, runPlan, seedWidget, setup, ZONE, zoneSnapshot } from "./test-helpers";
import { planTurnOff } from "./turn-off";
import { wantedRedirectRules, wantedRewriteRules } from "./wanted";

const HOST = "example.com";
const LIVE = { takeOverLiveSite: true };
const liveSite = {
  dnsRecords: { [ZONE.id]: [{ id: "a-apex", type: "A", name: HOST, content: "192.0.2.10", proxied: true }] },
};

async function runStep(plan: ReturnType<typeof planAttachDomain>, id: string) {
  return runNextStep(plan, { next: plan.steps.findIndex((step) => step.id === id) });
}

describe("only what the ledger names is Deparked's", () => {
  it("leaves routes and rules that merely look like Deparked's alone, on attach and on turn off", async () => {
    const { ctx, cf, mock, db } = await setup();
    await cf.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "deparked-sites" });
    await cf.zones.createRoute(ZONE.id, { pattern: "example.com/admin*", script: "deparked-admin" });
    for (const rule of wantedRewriteRules(HOST, [])) await cf.rulesets.addRule(ZONE.id, "http_request_transform", rule);
    for (const rule of wantedRedirectRules(HOST)) {
      await cf.rulesets.addRule(ZONE.id, "http_request_dynamic_redirect", rule);
    }
    const lookAlikes = zoneSnapshot(mock);
    mock.calls.length = 0;

    const reports = await runPlan(planAttachDomain(ctx, HOST));
    expect(reports.at(-1)).toMatchObject({ finished: true });
    expect(mock.callsTo("rulesets.addRule")).toEqual([]);
    expect(mock.callsTo("routes.create").map((call) => call.body)).toEqual([
      { pattern: "example.com/api/*", script: "deparked-admin" },
    ]);
    const ledger = await listLedger(db, { host: HOST });
    expect(ledger.filter((entry) => entry.resource === "rule")).toEqual([]);
    expect(ledger.filter((entry) => entry.resource === "route")).toHaveLength(1);
    expect(reports.find((report) => report.step?.id === "rewrite")).toMatchObject({ outcome: "already-done" });

    await runPlan(planTurnOff(ctx, HOST));
    const after = zoneSnapshot(mock);
    expect(after.routes).toEqual(lookAlikes.routes);
    expect(after.rewriteRules).toEqual(lookAlikes.rewriteRules);
    expect(after.redirectRules).toEqual(lookAlikes.redirectRules);
  });

  it("stops when a rule carries Deparked's name but does something else", async () => {
    const { ctx, cf, mock } = await setup();
    const [pages] = wantedRewriteRules(HOST, []);
    if (pages === undefined) throw new Error("no rule");
    await cf.rulesets.addRule(ZONE.id, "http_request_transform", {
      ...pages,
      expression: '(http.host eq "example.com")',
    });
    const before = zoneSnapshot(mock);

    const reports = await runPlan(planAttachDomain(ctx, HOST));
    expect(reports.at(-1)).toMatchObject({ outcome: "blocked", step: { id: "register" } });
    expect(reports.at(-1)?.message).toContain("Deparked did not create it and will not touch it");
    expect(zoneSnapshot(mock)).toEqual(before);
    expect(await runStep(planAttachDomain(ctx, HOST), "rewrite")).toMatchObject({ outcome: "blocked" });
  });

  it.each([
    ["routes.create", "routes"],
    ["rulesets.create", "rewrite"],
    ["rulesets.addRule", "rewrite"],
    ["dns.create", "dns"],
    ["turnstile.create", "bot-check"],
    ["workers.putSecret", "bot-check"],
    ["turnstile.update", "bot-check"],
    ["analytics.createSite", "analytics"],
    ["email.enableRouting", "email"],
  ])(
    "a %s that worked but was never confirmed leaves one resource and a correct ledger after Retry",
    async (route, stepId) => {
      const clean = await setup();
      if (route === "turnstile.update") await seedWidget(clean, 1);
      await runPlan(planAttachDomain(clean.ctx, HOST));
      const shape = (snapshot: ReturnType<typeof zoneSnapshot>) =>
        JSON.stringify(snapshot).replace(/"(id|siteTag|siteToken)":"[^"]+"/g, '"$1":"?"');

      const context = await setup();
      if (route === "turnstile.update") await seedWidget(context, 1);
      const { ctx, mock, db } = context;
      if (route === "rulesets.addRule") {
        // The zone already has a rule list, so Deparked's first rule is appended to it.
        await ctx.cf.rulesets.addRule(ZONE.id, "http_request_transform", {
          action: "rewrite",
          description: "old paths",
          expression: 'starts_with(http.request.uri.path, "/old/")',
          action_parameters: { uri: { path: { value: "/new" } } },
        });
      }
      // A 5xx is an unknown outcome; a 4xx would tell Deparked that nothing was created.
      const status = ["workers.putSecret", "turnstile.update", "turnstile.create"].includes(route) ? 403 : 502;
      mock.failNext({ route, status, applyFirst: true });

      const first = await runPlan(planAttachDomain(ctx, HOST));
      expect(first.at(-1), route).toMatchObject({ outcome: "failed", step: { id: stepId } });
      const second = await runPlan(planAttachDomain(ctx, HOST));
      expect(second.at(-1), route).toMatchObject({ finished: true });

      const snapshot = zoneSnapshot(mock);
      if (route !== "rulesets.addRule") expect(shape(snapshot)).toBe(shape(zoneSnapshot(clean.mock)));
      expect(snapshot.routes).toHaveLength(3);
      expect(snapshot.rewriteRules.filter((rule) => rule.description?.startsWith("Deparked"))).toHaveLength(2);
      expect(snapshot.dns.filter((record) => record.type === "AAAA")).toHaveLength(2);
      expect(snapshot.analyticsSites).toHaveLength(1);
      expect(mock.state.widgets.filter((widget) => widget.domains.includes(HOST))).toHaveLength(1);
      expect(mock.state.widgets).toHaveLength(1);
      expect(mock.liveBindings("deparked-admin").filter((binding) => binding.type === "secret_text")).toHaveLength(
        route === "turnstile.update" ? 0 : 1,
      );

      const ledger = await listLedger(db, { host: HOST, activeOnly: true });
      expect(ledger.map((entry) => entry.resource).sort()).toEqual([
        "analytics_site",
        "dns_record",
        "dns_record",
        "email_routing",
        "route",
        "route",
        "route",
        "rule",
        "rule",
        "rule",
        "turnstile_hostname",
      ]);
      expect(ledger.every((entry) => entry.cfId !== null)).toBe(true);
      const ids = new Set([
        ...snapshot.routes.map((entry) => entry.id),
        ...snapshot.rewriteRules.map((entry) => entry.id),
        ...snapshot.redirectRules.map((entry) => entry.id),
        ...snapshot.dns.map((entry) => entry.id),
        ...snapshot.analyticsSites.map((entry) => entry.siteTag),
        ...mock.state.widgets.map((entry) => entry.sitekey),
        ZONE.id,
      ]);
      expect(ledger.every((entry) => ids.has(entry.cfId ?? ""))).toBe(true);

      // And everything Deparked made is found again by Turn off.
      await runPlan(planTurnOff(ctx, HOST));
      const off = zoneSnapshot(mock);
      expect([off.routes, off.dns, off.redirectRules, off.analyticsSites, off.emailRouting]).toEqual([
        [],
        [],
        [],
        [],
        false,
      ]);
      expect(off.rewriteRules.map((rule) => rule.description)).toEqual(
        route === "rulesets.addRule" ? ["old paths"] : [],
      );
    },
  );

  it("remembers the original of a re-pointed route even when the re-point is never confirmed", async () => {
    const { ctx, cf, mock, db } = await setup();
    const original = await cf.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "my-site" });
    mock.failNext({ route: "routes.update", status: 403, applyFirst: true });
    const options = { repointExistingRoutes: true, takeOverLiveSite: true };

    expect((await runPlan(planAttachDomain(ctx, HOST, options))).at(-1)).toMatchObject({ outcome: "failed" });
    expect((await runPlan(planAttachDomain(ctx, HOST, options))).at(-1)).toMatchObject({ finished: true });
    const entries = (await listLedger(db, { host: HOST })).filter((entry) => entry.cfId === original.id);
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0]?.previousJson ?? "")).toEqual({ pattern: "example.com/*", script: "my-site" });
  });
});

describe("a domain that serves a live site", () => {
  it("is not touched until the takeover is confirmed, and the summary says what stops being served", async () => {
    const { ctx, cf, mock, db } = await setup(liveSite);
    await cf.zones.createRoute(ZONE.id, { pattern: "example.com/shop*", script: "shop" });
    mock.calls.length = 0;

    const inspection = await inspectDomain(ctx, HOST);
    expect(inspection.servesWebsite).toBe(true);
    expect(inspection.summary).toContain("example.com shows a website today");
    expect(inspection.summary).toContain("visitors get the for-sale page instead");
    expect(inspection.summary).toContain("Turn off brings it back");
    expect(inspection.summary).toContain("example.com/shop* keeps going to your Worker shop");

    const reports = await runPlan(planAttachDomain(ctx, HOST));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ outcome: "blocked", step: { id: "register" }, state: PLAN_START });
    expect(reports[0]?.message).toContain("Confirm that Deparked may take over example.com");
    expect(mutatingCalls(mock)).toEqual([]);
    expect(await getDomain(db, HOST)).toBeUndefined();
    expect((await dryRun(planAttachDomain(ctx, HOST))).blocked).toBe(true);
  });

  it("publishes the placeholder before any route or rule goes live, and keeps the owner's own paths out of the rewrite", async () => {
    const { ctx, cf, mock, published } = await setup(liveSite);
    await cf.zones.createRoute(ZONE.id, { pattern: "example.com/shop*", script: "shop" });
    await cf.zones.createRoute(ZONE.id, { pattern: "example.com/health", script: "shop" });
    mock.calls.length = 0;

    const reports = await runPlan(planAttachDomain(ctx, HOST, LIVE));
    expect(reports.map((report) => report.step?.id)).toEqual([
      "register",
      "bot-check",
      "analytics",
      "email",
      "publish-placeholder",
      "routes",
      "rewrite",
      "www-redirect",
      "dns",
      "ready",
    ]);
    expect(reports.at(-1)).toMatchObject({ finished: true });
    expect(published).toEqual([{ host: HOST, routesAtThatTime: 2 }]);
    const publishedAt = reports.findIndex((report) => report.step?.id === "publish-placeholder");
    expect(mock.callsTo("routes.create")).toHaveLength(3);
    expect(
      reports
        .slice(0, publishedAt + 1)
        .flatMap((report) => report.effects.map((effect) => effect.what))
        .join(),
    ).not.toContain("answered by");

    const [pages] = zoneSnapshot(mock).rewriteRules;
    expect(pages?.expression).toContain('and not starts_with(lower(http.request.uri.path), "/shop")');
    expect(pages?.expression).toContain('and lower(http.request.uri.path) ne "/health"');
    expect(mock.state.routes.get(ZONE.id)?.slice(0, 2)).toMatchObject([{ script: "shop" }, { script: "shop" }]);

    const again = await runPlan(planAttachDomain(ctx, HOST));
    expect(again.every((report) => report.outcome === "already-done")).toBe(true);
    expect(published).toHaveLength(1);
  });

  it("stops when the owner's route cannot be kept out of the rewrite", async () => {
    const { ctx, cf, mock } = await setup();
    await cf.zones.createRoute(ZONE.id, { pattern: "example.com/*/img*", script: "images" });
    mock.calls.length = 0;

    const [report] = await runPlan(planAttachDomain(ctx, HOST, LIVE));
    expect(report).toMatchObject({ outcome: "blocked", step: { id: "register" } });
    expect(report?.message).toContain("example.com/*/img*");
    expect(mutatingCalls(mock)).toEqual([]);
  });

  it("stops at the start when nothing can publish the placeholder", async () => {
    const { ctx, mock } = await setup({}, { publisher: false });
    const [report] = await runPlan(planAttachDomain(ctx, HOST));
    expect(report).toMatchObject({ outcome: "blocked", step: { id: "register" } });
    expect(report?.message).toContain("placeholder page");
    expect(mutatingCalls(mock)).toEqual([]);
    expect(await runStep(planAttachDomain(ctx, HOST), "publish-placeholder")).toMatchObject({ outcome: "blocked" });
  });

  it("does not put a record over www when a wildcard record covers it, unless the takeover is confirmed", async () => {
    const wildcard = { id: "a-any", type: "A", name: `*.${HOST}`, content: "192.0.2.20", proxied: false };
    const first = await setup({ dnsRecords: { [ZONE.id]: [wildcard] } });
    expect((await inspectDomain(first.ctx, HOST)).summary).toContain(
      "www.example.com is covered by your wildcard record and keeps going where it goes today",
    );
    const addresses = (context: typeof first) =>
      context.mock.state.dnsRecords
        .get(ZONE.id)
        ?.filter((record) => record.type !== "MX")
        .map((record) => record.name);
    await runPlan(planAttachDomain(first.ctx, HOST));
    expect(addresses(first)).toEqual([`*.${HOST}`, HOST]);

    const second = await setup({ dnsRecords: { [ZONE.id]: [wildcard] } });
    await runPlan(planAttachDomain(second.ctx, HOST, LIVE));
    expect(addresses(second)).toEqual([`*.${HOST}`, HOST, `www.${HOST}`]);
  });
});

describe("the bot check slot", () => {
  it("two attaches racing for the last place end in different widgets, each counted once", async () => {
    const context = await setup({ zones: [ZONE, { id: "zone-2", name: "example.org" }] });
    const { ctx, mock, db } = context;
    const widget = await seedWidget(context, 9);
    const plans = [planAttachDomain(ctx, HOST), planAttachDomain(ctx, "example.org")];
    for (const plan of plans) await runNextStep(plan, PLAN_START);

    const reports = await Promise.all(plans.map((plan) => runStep(plan, "bot-check")));
    expect(reports.map((report) => report.outcome).toSorted()).toEqual(["busy", "ran"]);
    const busy = reports.findIndex((report) => report.outcome === "busy");
    expect(reports[busy]).toMatchObject({ message: BUSY_MESSAGE, requests: 0, effects: [] });
    const retry = plans[busy];
    if (retry === undefined) throw new Error("no plan");
    expect(await runStep(retry, "bot-check")).toMatchObject({ outcome: "ran" });
    const [first, second] = mock.state.widgets;
    expect(first?.domains).toHaveLength(10);
    expect(second?.domains).toHaveLength(1);
    expect(
      [...(first?.domains ?? []), ...(second?.domains ?? [])].filter((name) => name.startsWith("example.")),
    ).toHaveLength(2);
    expect(await listTurnstileWidgets(db)).toMatchObject([
      { sitekey: widget.sitekey, hostnameCount: 10 },
      { name: "deparked-2", hostnameCount: 1 },
    ]);
  });

  it("a crash between taking the place and telling Cloudflare does not take a second place on Retry", async () => {
    const context = await setup();
    const { ctx, mock, db } = context;
    const widget = await seedWidget(context, 9);
    const plan = planAttachDomain(ctx, HOST);
    await runNextStep(plan, PLAN_START);
    mock.failNext({ route: "turnstile.update", status: 403 });

    expect(await runStep(plan, "bot-check")).toMatchObject({ outcome: "failed" });
    expect(await getDomain(db, HOST)).toMatchObject({ turnstileWidgetId: widget.sitekey });
    expect(await listTurnstileWidgets(db)).toMatchObject([{ hostnameCount: 10 }]);

    expect(await runStep(plan, "bot-check")).toMatchObject({ outcome: "ran" });
    expect(await listTurnstileWidgets(db)).toMatchObject([{ hostnameCount: 10 }]);
    expect(mock.state.widgets).toHaveLength(1);
    expect(mock.state.widgets[0]?.domains.filter((name) => name === HOST)).toHaveLength(1);
  });

  it("turn off only frees a place the domain holds, and never writes a stale hostname list", async () => {
    const context = await setup();
    const { ctx, mock, db } = context;
    await seedWidget(context, 3);
    await runPlan(planAttachDomain(ctx, HOST));
    // A ledger row alone is not a held place.
    await insertLedgerEntry(db, {
      host: HOST,
      resource: "turnstile_hostname",
      cfId: "not-held",
      action: "created",
      now: 1,
    });
    // Someone else's hostname arrives after the attach: it must survive the turn off.
    mock.state.widgets[0]?.domains.push("late.test");

    await runPlan(planTurnOff(ctx, HOST));
    expect(mock.state.widgets[0]?.domains).toEqual(["domain-0.test", "domain-1.test", "domain-2.test", "late.test"]);
    expect(await listTurnstileWidgets(db)).toMatchObject([{ hostnameCount: 3 }]);
    await runPlan(planTurnOff(ctx, HOST));
    expect(await listTurnstileWidgets(db)).toMatchObject([{ hostnameCount: 3 }]);
  });
});

describe("turn off never makes things worse", () => {
  async function repointed() {
    const context = await setup();
    const original = await context.cf.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "my-site" });
    await runPlan(planAttachDomain(context.ctx, HOST, { repointExistingRoutes: true, takeOverLiveSite: true }));
    return { ...context, original };
  }
  const routeEntry = async (db: Parameters<typeof listLedger>[0], id: string) =>
    (await listLedger(db, { host: HOST })).find((entry) => entry.cfId === id);

  it("leaves a re-pointed route the owner changed since, and says so", async () => {
    const { ctx, cf, mock, db, original } = await repointed();
    await cf.zones.updateRoute(ZONE.id, original.id, { pattern: "example.com/*", script: "new-site" });

    const reports = await runPlan(planTurnOff(ctx, HOST));
    expect(reports.at(-1)).toMatchObject({ finished: true });
    expect(reports.find((report) => report.step?.id === "stop-routes")?.effects).toContainEqual({
      kind: "reuse",
      what: "left as is: example.com/* was changed after Deparked set it",
    });
    expect(mock.state.routes.get(ZONE.id)).toEqual([{ id: original.id, pattern: "example.com/*", script: "new-site" }]);
    const entry = await routeEntry(db, original.id);
    expect(entry?.undoneAt).not.toBeNull();
    expect(JSON.parse(entry?.previousJson ?? "")).toMatchObject({
      script: "my-site",
      note: "left as is: changed after Deparked",
    });
  });

  it("does not bring back a re-pointed route the owner deleted", async () => {
    const { ctx, cf, mock, original } = await repointed();
    await cf.zones.deleteRoute(ZONE.id, original.id);
    const reports = await runPlan(planTurnOff(ctx, HOST));
    expect(reports.at(-1)).toMatchObject({ finished: true });
    expect(mock.state.routes.get(ZONE.id)).toEqual([]);
    // The owner's own route and Deparked's two admin routes: nothing was created again on Turn off.
    expect(mock.callsTo("routes.create")).toHaveLength(3);
  });

  it("is not stuck when Cloudflare refuses the restore with a conflict", async () => {
    const { ctx, mock, db, original } = await repointed();
    mock.failNext({ route: "routes.update", status: 409, times: 5 });
    const reports = await runPlan(planTurnOff(ctx, HOST));
    expect(reports.at(-1)).toMatchObject({ finished: true });
    expect((await routeEntry(db, original.id))?.undoneAt).not.toBeNull();
  });

  it("treats everything that is already gone as undone", async () => {
    const { ctx, mock, db } = await setup();
    await runPlan(planAttachDomain(ctx, HOST));
    mock.state.routes.set(ZONE.id, []);
    mock.state.dnsRecords.set(ZONE.id, []);
    mock.state.rulesets.clear();
    mock.state.analyticsSites.length = 0;
    mock.state.widgets.length = 0;
    mock.state.emailRouting.set(ZONE.id, false);
    mock.calls.length = 0;

    const reports = await runPlan(planTurnOff(ctx, HOST));
    expect(reports.map((report) => report.outcome)).toEqual(Array(7).fill("ran"));
    // Deletes of what is gone answer 404 and count as done; nothing is created or changed again.
    expect(mutatingCalls(mock).filter((call) => call.method !== "DELETE")).toEqual([]);
    expect(await listLedger(db, { host: HOST, activeOnly: true })).toEqual([]);
    expect(await getDomain(db, HOST)).toMatchObject({ status: "off", turnstileWidgetId: null });
  });

  it("puts mail records back with their priority and TTL, and reports one Cloudflare would refuse", async () => {
    const records = [
      { ...MX_EXTERNAL[0], ttl: 3600 },
      { id: "mx-broken", type: "MX", name: HOST, content: "mail.example.net", ttl: 300 },
    ] as typeof MX_EXTERNAL;
    const { ctx, mock } = await setup({ dnsRecords: { [ZONE.id]: records } });
    await runPlan(planAttachDomain(ctx, HOST, { replaceExistingMx: true }));

    const reports = await runPlan(planTurnOff(ctx, HOST));
    expect(reports.at(-1)).toMatchObject({ finished: true });
    expect(mock.callsTo("dns.create").at(-1)?.body).toEqual({
      type: "MX",
      name: HOST,
      content: "aspmx.l.google.com",
      priority: 1,
      ttl: 3600,
    });
    expect(mock.state.dnsRecords.get(ZONE.id)?.filter((record) => record.type === "MX")).toHaveLength(1);
    expect(reports.find((report) => report.step?.id === "stop-email")?.effects).toContainEqual({
      kind: "reuse",
      what: "not put back: the mail record mail.example.net had no priority, add it by hand in Cloudflare",
    });
  });
});
