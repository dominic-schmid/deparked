import { claimTurnstileSlot, getDomain, insertTurnstileWidget, listLedger, listTurnstileWidgets } from "@deparked/db";
import { describe, expect, it } from "vitest";
import { planAttachDomain } from "./attach";
import { dryRun, PLAN_START, runNextStep } from "./steps";
import { mutatingCalls, runPlan, seedWidget, setup, ZONE, zoneSnapshot } from "./test-helpers";

const HOST = "example.com";

/** A zone that already serves a site: its own Workers, rules, DNS and mail. */
function busyZone() {
  return {
    dnsRecords: {
      [ZONE.id]: [
        { id: "a-apex", type: "A", name: HOST, content: "192.0.2.10", proxied: true },
        { id: "a-www", type: "CNAME", name: `www.${HOST}`, content: HOST, proxied: true },
        { id: "a-blog", type: "A", name: `blog.${HOST}`, content: "192.0.2.11", proxied: true },
        { id: "mx-1", type: "MX", name: HOST, content: "aspmx.l.google.com", priority: 1 },
        { id: "mx-2", type: "MX", name: HOST, content: "alt1.aspmx.l.google.com", priority: 5 },
        { id: "spf", type: "TXT", name: HOST, content: "v=spf1 include:_spf.google.com ~all" },
      ],
    },
  };
}

async function seedBusyRoutesAndRules(context: Awaited<ReturnType<typeof setup>>) {
  const { cf, mock } = context;
  await cf.zones.createRoute(ZONE.id, { pattern: `blog.${HOST}/*`, script: "blog" });
  await cf.zones.createRoute(ZONE.id, { pattern: `${HOST}/shop*`, script: "shop" });
  await cf.rulesets.addRule(ZONE.id, "http_request_transform", {
    action: "rewrite",
    description: "old paths",
    expression: 'starts_with(http.request.uri.path, "/old/")',
    action_parameters: { uri: { path: { value: "/new" } } },
  });
  await cf.rulesets.addRule(ZONE.id, "http_request_dynamic_redirect", {
    action: "redirect",
    description: "shop moved",
    expression: 'http.request.uri.path eq "/store"',
    action_parameters: { from_value: { status_code: 302, target_url: { value: "https://example.com/shop" } } },
  });
  mock.calls.length = 0;
}

describe("attaching a domain on a clean zone", () => {
  it("runs one step per call, in the documented order, and ends by asking for the placeholder publish", async () => {
    const { ctx } = await setup();
    const reports = await runPlan(planAttachDomain(ctx, HOST));

    expect(reports.map((report) => [report.step?.id, report.outcome])).toEqual([
      ["register", "ran"],
      ["bot-check", "ran"],
      ["analytics", "ran"],
      ["email", "ran"],
      ["publish-placeholder", "ran"],
      ["routes", "ran"],
      ["rewrite", "ran"],
      ["www-redirect", "ran"],
      ["dns", "ran"],
      ["ready", "ran"],
    ]);
    expect(reports.at(-1)).toMatchObject({ finished: true });
    expect(reports.slice(0, -1).every((report) => !report.finished)).toBe(true);
    for (const report of reports) expect(report.requests).toBeLessThanOrEqual(50);
    // The routes step looks for a live site again right before it changes anything (an inspection, 7 requests).
    expect(Math.max(...reports.map((report) => report.requests))).toBeLessThanOrEqual(16);
  });

  it("creates the routes, rules, records, bot check, statistics and email, and the domains row", async () => {
    const { ctx, mock, db } = await setup();
    await runPlan(planAttachDomain(ctx, HOST));

    expect(mock.state.routes.get(ZONE.id)?.map(({ pattern, script }) => [pattern, script])).toEqual([
      ["example.com/*", "deparked-sites"],
      ["example.com/admin*", "deparked-admin"],
      ["example.com/api/*", "deparked-admin"],
    ]);
    const snapshot = zoneSnapshot(mock);
    expect(snapshot.rewriteRules).toMatchObject([
      {
        description: "Deparked example.com: pages",
        expression:
          '(http.host eq "example.com" and http.request.uri.path ne "/" and not starts_with(http.request.uri.path, "/catalog/") and not starts_with(http.request.uri.path, "/admin") and not starts_with(http.request.uri.path, "/api/"))',
        action_parameters: { uri: { path: { expression: 'concat("/sites/", http.host, http.request.uri.path)' } } },
      },
      {
        description: "Deparked example.com: home page",
        expression: '(http.host eq "example.com" and http.request.uri.path eq "/")',
        action_parameters: { uri: { path: { value: "/sites/example.com/index.html" } } },
      },
    ]);
    expect(snapshot.redirectRules).toMatchObject([
      {
        action: "redirect",
        expression: '(http.host eq "www.example.com")',
        action_parameters: {
          from_value: {
            status_code: 301,
            target_url: { expression: 'concat("https://example.com", http.request.uri.path)' },
            preserve_query_string: true,
          },
        },
      },
    ]);
    expect(snapshot.dns.filter((record) => record.type === "AAAA")).toMatchObject([
      { name: "example.com", content: "100::", proxied: true },
      { name: "www.example.com", content: "100::", proxied: true },
    ]);
    expect(mock.state.widgets).toMatchObject([{ name: "deparked-1", domains: ["example.com"] }]);
    expect(mock.liveBindings("deparked-admin")).toContainEqual({
      type: "secret_text",
      name: "TURNSTILE_SECRET_1",
      text: mock.state.widgets[0]?.secret,
    });
    expect(snapshot.analyticsSites).toMatchObject([{ host: "example.com" }]);
    expect(snapshot.emailRouting).toBe(true);

    expect(await listTurnstileWidgets(db)).toMatchObject([
      { name: "deparked-1", hostnameCount: 1, secretName: "TURNSTILE_SECRET_1" },
    ]);
    expect(await getDomain(db, HOST)).toMatchObject({
      status: "placeholder",
      zoneId: ZONE.id,
      turnstileWidgetId: mock.state.widgets[0]?.sitekey,
      analyticsSiteTag: mock.state.analyticsSites[0]?.siteTag,
      analyticsBeaconToken: mock.state.analyticsSites[0]?.siteToken,
      emailRoutingState: "enabled",
      senderHost: "example.com",
    });
  });

  it("writes every change to the ledger with its Cloudflare id", async () => {
    const { ctx, mock, db } = await setup();
    await runPlan(planAttachDomain(ctx, HOST));

    const routes = mock.state.routes.get(ZONE.id) ?? [];
    const snapshot = zoneSnapshot(mock);
    const placeholders = snapshot.dns.filter((record) => record.type === "AAAA");
    const entries = (await listLedger(db, { host: HOST })).reverse();
    expect(entries.map(({ resource, cfId, action }) => [resource, cfId, action])).toEqual([
      ["turnstile_hostname", mock.state.widgets[0]?.sitekey, "created"],
      ["analytics_site", mock.state.analyticsSites[0]?.siteTag, "created"],
      ["email_routing", ZONE.id, "created"],
      ...routes.map((route) => ["route", route.id, "created"]),
      ...snapshot.rewriteRules.map((rule) => ["rule", rule.id, "created"]),
      ...snapshot.redirectRules.map((rule) => ["rule", rule.id, "created"]),
      ...placeholders.map((record) => ["dns_record", record.id, "created"]),
    ]);
    expect(entries.every((entry) => entry.undoneAt === null && entry.zoneId !== undefined)).toBe(true);
    // A created entry says what it was written for, since the ledger is written before the resource exists.
    expect(entries.filter((entry) => entry.resource === "route").map((entry) => entry.previousJson)).toEqual(
      routes.map((route) => JSON.stringify({ intent: route.pattern })),
    );
    // The widget's secret is shared by every domain, so it is a hub-level entry.
    expect(await listLedger(db, { host: null })).toMatchObject([
      { resource: "secret", cfId: "TURNSTILE_SECRET_1", action: "created" },
    ]);
  });

  it("does nothing the second time: every step is already done and no mutating call is made", async () => {
    const { ctx, mock } = await setup();
    await runPlan(planAttachDomain(ctx, HOST));
    const before = zoneSnapshot(mock);
    mock.calls.length = 0;

    const again = await runPlan(planAttachDomain(ctx, HOST));
    expect(again.map((report) => report.outcome)).toEqual(Array(10).fill("already-done"));
    expect(mutatingCalls(mock)).toEqual([]);
    expect(zoneSnapshot(mock)).toEqual(before);
    expect(await dryRun(planAttachDomain(ctx, HOST))).toMatchObject({ nothingToDo: true, blocked: false });
    expect(await runNextStep(planAttachDomain(ctx, HOST), again.at(-1)?.state)).toMatchObject({
      outcome: "finished",
      step: null,
      requests: 0,
    });
  });

  it("rejects a state that is not a step of the plan and a host that is not a domain name", async () => {
    const { ctx } = await setup();
    await expect(runNextStep(planAttachDomain(ctx, HOST), { next: 11 })).rejects.toThrow(RangeError);
    await expect(runNextStep(planAttachDomain(ctx, HOST), { next: 0.5 })).rejects.toThrow(RangeError);
    expect(() => planAttachDomain(ctx, 'example.com" or true')).toThrow("is not a domain name");
    expect(planAttachDomain(ctx, " Example.COM. ").host).toBe("example.com");
  });
});

describe("dry run", () => {
  it("lists what each step would create without changing anything", async () => {
    const { ctx, mock } = await setup();
    const report = await dryRun(planAttachDomain(ctx, HOST));

    expect(report).toMatchObject({ kind: "attach", host: HOST, nothingToDo: false, blocked: false });
    expect(report.requests).toBeLessThanOrEqual(50);
    expect(mutatingCalls(mock)).toEqual([]);
    expect(report.steps.map((step) => [step.id, step.status])).toEqual([
      ["register", "needed"],
      ["bot-check", "needed"],
      ["analytics", "needed"],
      ["email", "needed"],
      ["publish-placeholder", "needed"],
      ["routes", "needed"],
      ["rewrite", "needed"],
      ["www-redirect", "needed"],
      ["dns", "needed"],
      ["ready", "needed"],
    ]);
    const effects = report.steps.flatMap((step) => (step.status === "needed" ? step.effects : []));
    expect(effects.filter((effect) => effect.kind === "create").map((effect) => effect.what)).toEqual([
      "example.com in Deparked's list",
      "a new bot check deparked-1 for example.com",
      "the secret key of deparked-1, stored on the admin",
      "visitor statistics for example.com",
      "Cloudflare's email service for example.com, so offers come from offers@example.com",
      "a placeholder page for example.com",
      "example.com/* is answered by Deparked's pages",
      "example.com/admin* is answered by the Deparked admin",
      "example.com/api/* is answered by the Deparked admin",
      "a rule that serves example.com's files (not /catalog/, /admin, /api/ or your own Workers' paths)",
      "a rule that shows example.com's page at example.com/",
      "a rule that sends www.example.com to example.com",
      "an address record for example.com that goes through Cloudflare",
      "an address record for www.example.com that goes through Cloudflare",
    ]);
  });

  it("tells creates from reuses on a zone that already has records, statistics and a bot check with room", async () => {
    const context = await setup(busyZone());
    const { ctx, cf } = context;
    await cf.analytics.createSite(HOST);
    await seedWidget(context, 1);

    const report = await dryRun(planAttachDomain(ctx, HOST));
    const byStep = Object.fromEntries(
      report.steps.map((step) => [step.id, step.status === "blocked" ? [] : step.effects.map((effect) => effect.kind)]),
    );
    expect(byStep).toMatchObject({
      routes: ["create", "create", "create"],
      dns: ["reuse", "reuse"],
      "bot-check": ["change"],
      analytics: ["reuse"],
      email: ["reuse"],
    });
    expect(report.steps.find((step) => step.id === "email")).toMatchObject({
      effects: [{ what: expect.stringContaining("your existing mail for example.com stays as it is") }],
    });
  });
});

describe("attaching a domain that already serves a site", () => {
  it("only adds: nothing that existed is modified or deleted", async () => {
    const context = await setup(busyZone());
    const { ctx, mock, db } = context;
    await seedBusyRoutesAndRules(context);
    const before = zoneSnapshot(mock);

    const reports = await runPlan(planAttachDomain(ctx, HOST, { takeOverLiveSite: true }));
    expect(reports.at(-1)).toMatchObject({ finished: true, outcome: "ran" });

    const after = zoneSnapshot(mock);
    expect(after.dns).toEqual(before.dns);
    expect(after.routes.slice(0, before.routes.length)).toEqual(before.routes);
    expect(after.rewriteRules.slice(0, 1)).toEqual(before.rewriteRules);
    expect(after.redirectRules.slice(0, 1)).toEqual(before.redirectRules);
    expect(after.emailRouting).toBe(false);
    expect(after.routes).toHaveLength(before.routes.length + 3);
    expect(after.rewriteRules).toHaveLength(3);
    expect(after.redirectRules).toHaveLength(2);
    expect(mutatingCalls(mock).filter((call) => call.method === "DELETE" || call.route === "routes.update")).toEqual(
      [],
    );
    expect(mock.callsTo("rulesets.create")).toEqual([]);
    expect(await getDomain(db, HOST)).toMatchObject({ emailRoutingState: "kept_external", senderHost: null });
    expect((await listLedger(db, { host: HOST })).map((entry) => entry.resource)).not.toContain("dns_record");
  });

  it("stops before changing anything when a route with the same pattern belongs to another Worker", async () => {
    const context = await setup();
    const { ctx, cf, mock, db } = context;
    const original = await cf.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "my-site" });
    mock.calls.length = 0;

    const reports = await runPlan(planAttachDomain(ctx, HOST, { takeOverLiveSite: true }));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ outcome: "blocked", state: PLAN_START, finished: false });
    expect(reports[0]?.message).toContain("Another Worker already answers on example.com/* (my-site)");
    expect(mutatingCalls(mock)).toEqual([]);
    expect(await getDomain(db, HOST)).toBeUndefined();

    const confirmed = await runPlan(
      planAttachDomain(ctx, HOST, { repointExistingRoutes: true, takeOverLiveSite: true }),
    );
    expect(confirmed.at(-1)).toMatchObject({ finished: true });
    expect(mock.state.routes.get(ZONE.id)?.[0]).toEqual({
      id: original.id,
      pattern: "example.com/*",
      script: "deparked-sites",
    });
    const entry = (await listLedger(db, { host: HOST })).find((candidate) => candidate.cfId === original.id);
    expect(entry).toMatchObject({ resource: "route", action: "changed", zoneId: ZONE.id });
    expect(JSON.parse(entry?.previousJson ?? "")).toEqual({ pattern: "example.com/*", script: "my-site" });
  });

  it("refuses a domain whose address does not go through Cloudflare, without editing the record", async () => {
    const record = { id: "a-apex", type: "A", name: HOST, content: "192.0.2.10", proxied: false };
    const { ctx, mock } = await setup({ dnsRecords: { [ZONE.id]: [record] } });

    const [report] = await runPlan(planAttachDomain(ctx, HOST));
    expect(report).toMatchObject({ outcome: "blocked" });
    expect(report?.message).toContain("points straight at a server");
    expect(mutatingCalls(mock)).toEqual([]);
  });
});

describe("the bot check", () => {
  it("fills a widget with room and opens a new one when it is full", async () => {
    const context = await setup({
      zones: [ZONE, { id: "zone-2", name: "example.org" }, { id: "zone-3", name: "example.net" }],
    });
    const { ctx, mock, db } = context;
    await seedWidget(context, 9);
    const nine = Array.from({ length: 9 }, (_, index) => `domain-${index}.test`);

    await runPlan(planAttachDomain(ctx, "example.org"));
    expect(mock.state.widgets).toMatchObject([{ name: "deparked-1", domains: [...nine, "example.org"] }]);

    await runPlan(planAttachDomain(ctx, "example.net"));
    expect(mock.state.widgets).toMatchObject([
      { name: "deparked-1" },
      { name: "deparked-2", domains: ["example.net"] },
    ]);
    expect(mock.state.widgets[0]?.domains).toHaveLength(10);
    expect(await listTurnstileWidgets(db)).toMatchObject([
      { name: "deparked-1", hostnameCount: 10 },
      { name: "deparked-2", hostnameCount: 1, secretName: "TURNSTILE_SECRET_2" },
    ]);
    expect(mock.liveBindings("deparked-admin").map((binding) => binding.name)).toContain("TURNSTILE_SECRET_2");
    expect((await getDomain(db, "example.net"))?.turnstileWidgetId).toBe(mock.state.widgets[1]?.sitekey);
  });
});

describe("a step that fails midway", () => {
  it("reports the failure, keeps its place, and Retry finishes without duplicates", async () => {
    const { ctx, mock, db } = await setup();
    const plan = planAttachDomain(ctx, HOST);
    mock.failNext({ route: "routes.create", nth: 2, status: 403, message: "Authentication error" });

    const failed = (await runPlan(plan)).at(-1);
    expect(failed).toMatchObject({ outcome: "failed", step: { id: "routes" }, state: { next: 5 }, finished: false });
    expect(failed?.message).toContain("create Worker route failed: 403");
    expect(mock.state.routes.get(ZONE.id)).toHaveLength(1);

    const retried = await runNextStep(plan, failed?.state);
    expect(retried).toMatchObject({ outcome: "ran", state: { next: 6 } });
    expect(mock.state.routes.get(ZONE.id)?.map((route) => route.pattern)).toEqual([
      "example.com/*",
      "example.com/admin*",
      "example.com/api/*",
    ]);
    expect(
      (await listLedger(db, { host: HOST, activeOnly: true })).filter((entry) => entry.resource === "route"),
    ).toHaveLength(3);
  });

  it("finishes a bot check whose secret could not be stored instead of creating a second one", async () => {
    const { ctx, mock, db } = await setup();
    mock.failNext({ route: "workers.putSecret", status: 403 });

    const first = await runPlan(planAttachDomain(ctx, HOST));
    expect(first.at(-1)).toMatchObject({ outcome: "failed", step: { id: "bot-check" } });
    expect(await listTurnstileWidgets(db)).toEqual([]);

    const rest = await runPlan(planAttachDomain(ctx, HOST));
    expect(rest.at(-1)).toMatchObject({ finished: true });
    expect(mock.state.widgets).toHaveLength(1);
    expect(mock.callsTo("turnstile.create")).toHaveLength(1);
    expect(await listTurnstileWidgets(db)).toMatchObject([{ name: "deparked-1", hostnameCount: 1 }]);
    expect(
      (await listLedger(db, { host: HOST })).filter((entry) => entry.resource === "turnstile_hostname"),
    ).toHaveLength(1);
  });

  it("retries every failing mutation of an attach to the same end state", async () => {
    const mutating = [
      "routes.create",
      "rulesets.create",
      "rulesets.addRule",
      "dns.create",
      "turnstile.create",
      "analytics.createSite",
      "email.enableRouting",
    ];
    const clean = await setup();
    await runPlan(planAttachDomain(clean.ctx, HOST));
    const expected = zoneSnapshot(clean.mock);
    const shape = (snapshot: typeof expected) =>
      JSON.stringify(snapshot).replace(/"(id|siteTag|siteToken)":"[^"]+"/g, '"$1":"?"');

    for (const route of mutating) {
      const { ctx, mock, db } = await setup();
      mock.failNext({ route, status: 403 });
      const first = await runPlan(planAttachDomain(ctx, HOST));
      expect(first.at(-1)?.outcome, route).toBe("failed");
      const second = await runPlan(planAttachDomain(ctx, HOST));
      expect(second.at(-1), route).toMatchObject({ finished: true });
      expect(shape(zoneSnapshot(mock)), route).toBe(shape(expected));
      expect(await listLedger(db, { host: HOST, activeOnly: true }), route).toHaveLength(11);
    }
  });
});
