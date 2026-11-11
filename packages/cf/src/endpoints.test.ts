import { describe, expect, it } from "vitest";
import { classifyMx, verifyTurnstile } from "./index";
import { TURNSTILE_DUMMY_SECRET_FAIL, TURNSTILE_DUMMY_SECRET_PASS } from "./mock";
import { setup, ZONE } from "./testing";

describe("token", () => {
  it("verifies a user token in one request and an account token in two", async () => {
    const user = setup();
    expect(await user.client.tokens.verify()).toMatchObject({ status: "active", kind: "user" });
    expect(user.client.requestCount).toBe(1);

    const account = setup({ tokenKind: "account" });
    expect(await account.client.tokens.verify()).toMatchObject({ status: "active", kind: "account" });
    expect(account.client.requestCount).toBe(2);
  });

  it("rejects a wrong token with an error that names the call", async () => {
    const { mock, client } = setup();
    mock.state.token = "rotated";
    await expect(client.tokens.verify()).rejects.toThrow("verify API token failed: 401 Invalid API Token (code 1000)");
  });

  it("names the permissions the token lacks, in the owner's words", async () => {
    const { mock, client } = setup({ workersSubdomain: null });
    mock.denyPermission("d1");
    mock.denyPermission("rulesets");

    expect(await client.tokens.probePermissions()).toMatchObject({ missing: ["D1"] });
    const before = client.requestCount;
    const report = await client.tokens.probePermissions({ zoneId: ZONE.id });
    expect(report.missing).toEqual(["D1", "Transform Rules", "Dynamic Redirect"]);
    expect(report.checked).toHaveLength(11);
    expect(client.requestCount - before).toBe(11);
  });
});

describe("accounts, zones, DNS and routes", () => {
  it("reads the account and its workers.dev subdomain", async () => {
    const { mock, client } = setup({ accountName: "Owner", workersSubdomain: "owner" });
    expect(await client.accounts.get()).toEqual({ id: mock.state.accountId, name: "Owner" });
    expect(await client.accounts.workersSubdomain()).toBe("owner");

    mock.state.workersSubdomain = null;
    expect(await client.accounts.workersSubdomain()).toBeNull();
  });

  it("lists zones, finds one by name and reads one by id", async () => {
    const { client } = setup({ zones: [ZONE, { id: "zone-2", name: "example.org" }] });
    expect((await client.zones.list()).map((zone) => zone.name)).toEqual(["example.com", "example.org"]);
    expect(await client.zones.list({ name: "example.org" })).toMatchObject([{ id: "zone-2" }]);
    expect(await client.zones.get("zone-2")).toMatchObject({ name: "example.org" });
    await expect(client.zones.get("nope")).rejects.toThrow("read zone failed: 404");
  });

  it("reads DNS records by type and name", async () => {
    const { client } = setup({
      dnsRecords: {
        [ZONE.id]: [
          { id: "r1", type: "A", name: "example.com", content: "192.0.2.1" },
          { id: "r2", type: "MX", name: "example.com", content: "mail.example.net", priority: 10 },
          { id: "r3", type: "A", name: "www.example.com", content: "192.0.2.1" },
        ],
      },
    });
    expect(await client.zones.listDnsRecords(ZONE.id, { type: "MX", name: "example.com" })).toEqual([
      { id: "r2", type: "MX", name: "example.com", content: "mail.example.net", priority: 10 },
    ]);
    expect(await client.zones.listDnsRecords(ZONE.id, { name: "www.example.com" })).toHaveLength(1);
  });

  it("creates, lists and deletes Worker routes", async () => {
    const { client } = setup();
    const lander = await client.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "deparked-sites" });
    const admin = await client.zones.createRoute(ZONE.id, { pattern: "example.com/admin*", script: "deparked-admin" });
    expect(await client.zones.listRoutes(ZONE.id)).toEqual([lander, admin]);

    await expect(client.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "other" })).rejects.toThrow(
      "create Worker route failed: 409",
    );
    await client.zones.deleteRoute(ZONE.id, lander.id);
    expect(await client.zones.listRoutes(ZONE.id)).toEqual([admin]);
  });
});

describe("rulesets", () => {
  const rewrite = {
    action: "rewrite" as const,
    description: "deparked: serve /sites/<host>",
    expression: 'not starts_with(http.request.uri.path, "/catalog/")',
    action_parameters: { uri: { path: { expression: 'concat("/sites/", http.host, http.request.uri.path)' } } },
  };
  const redirect = {
    action: "redirect" as const,
    description: "deparked: www to apex",
    expression: 'http.host eq "www.example.com"',
    action_parameters: {
      from_value: { status_code: 301 as const, target_url: { value: "https://example.com/" } },
    },
  };

  it("creates the phase's ruleset when the zone has none", async () => {
    const { mock, client } = setup();
    expect(await client.rulesets.getEntrypoint(ZONE.id, "http_request_transform")).toBeNull();

    const added = await client.rulesets.addRule(ZONE.id, "http_request_transform", rewrite);
    expect(added.rule).toMatchObject({ action: "rewrite", description: rewrite.description });
    expect(mock.callsTo("rulesets.create")[0]?.body).toMatchObject({ kind: "zone", phase: "http_request_transform" });
    expect(client.requestCount).toBe(3);
  });

  it("appends to an existing list and never replaces it", async () => {
    const { mock, client } = setup();
    const owners = { id: "owner-rule", action: "redirect", expression: "true", description: "mine", enabled: true };
    mock.state.rulesets.set(`${ZONE.id}:http_request_dynamic_redirect`, {
      id: "ruleset-existing",
      phase: "http_request_dynamic_redirect",
      rules: [owners],
    });

    const added = await client.rulesets.addRule(ZONE.id, "http_request_dynamic_redirect", redirect);
    expect(added.rulesetId).toBe("ruleset-existing");
    expect(added.rule.id).not.toBe("owner-rule");

    const after = await client.rulesets.getEntrypoint(ZONE.id, "http_request_dynamic_redirect");
    expect(after?.rules.map((rule) => rule.description)).toEqual(["mine", "deparked: www to apex"]);
    expect(mock.calls.filter((call) => call.method === "PUT")).toEqual([]);
    expect(mock.callsTo("rulesets.create")).toEqual([]);
  });

  it("deletes one rule by id and leaves the others", async () => {
    const { client } = setup();
    const first = await client.rulesets.addRule(ZONE.id, "http_request_transform", rewrite);
    const second = await client.rulesets.addRule(ZONE.id, "http_request_transform", {
      ...rewrite,
      description: "deparked: root",
    });

    await client.rulesets.deleteRule(ZONE.id, first.rulesetId, first.rule.id);
    const left = await client.rulesets.getEntrypoint(ZONE.id, "http_request_transform");
    expect(left?.rules.map((rule) => rule.id)).toEqual([second.rule.id]);
  });
});

describe("D1", () => {
  it("creates and finds a database by name", async () => {
    const { client } = setup();
    expect(await client.d1.list({ name: "deparked" })).toEqual([]);
    const created = await client.d1.create("deparked");
    expect(await client.d1.list({ name: "deparked" })).toEqual([created]);
  });

  it("runs a migration twice and reads rows back", async () => {
    const { client } = setup();
    const { uuid } = await client.d1.create("deparked");
    const migration =
      "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT); CREATE INDEX IF NOT EXISTS notes_body ON notes (body);";

    expect(await client.d1.query(uuid, migration)).toHaveLength(2);
    await client.d1.query(uuid, migration);
    await client.d1.query(uuid, "INSERT INTO notes (body) VALUES (?)", ["semi;colon"]);
    const [result] = await client.d1.query(uuid, "SELECT body FROM notes WHERE body = ?", ["semi;colon"]);
    expect(result?.results).toEqual([{ body: "semi;colon" }]);
  });

  it("reads through the API a value written through the binding (the ownership check)", async () => {
    const { mock, client } = setup();
    const id = mock.addDatabase("deparked");
    mock.sql(id, "CREATE TABLE install_state (ownership_nonce TEXT)");
    mock.sql(id, "INSERT INTO install_state VALUES (?)", ["nonce-123"]);

    const [result] = await client.d1.query(id, "SELECT ownership_nonce FROM install_state");
    expect(result?.results[0]?.ownership_nonce).toBe("nonce-123");
  });

  it("reports a SQL error by the call's name", async () => {
    const { client } = setup();
    const { uuid } = await client.d1.create("deparked");
    await expect(client.d1.query(uuid, "SELECT * FROM missing")).rejects.toThrow("run D1 query failed: 400");
  });
});

describe("Turnstile", () => {
  it("creates a widget with its secret, lists without secrets, updates hostnames and deletes", async () => {
    const { client } = setup();
    const widget = await client.turnstile.create({ name: "deparked-1", domains: ["example.com"] });
    expect(widget).toMatchObject({ name: "deparked-1", mode: "managed", domains: ["example.com"] });
    expect(widget.secret).not.toBe("");

    expect(await client.turnstile.list()).toEqual([
      { sitekey: widget.sitekey, name: "deparked-1", mode: "managed", domains: ["example.com"] },
    ]);
    expect(await client.turnstile.getSecret(widget.sitekey)).toBe(widget.secret);

    const updated = await client.turnstile.updateHostnames(widget, ["example.com", "example.org"]);
    expect(updated).toEqual({
      sitekey: widget.sitekey,
      name: "deparked-1",
      mode: "managed",
      domains: ["example.com", "example.org"],
    });

    await client.turnstile.delete(widget.sitekey);
    expect(await client.turnstile.list()).toEqual([]);
  });

  it("is refused an eleventh hostname, and the widget keeps its ten", async () => {
    const { mock, client } = setup();
    const ten = Array.from({ length: 10 }, (_, index) => `site-${index}.example`);
    const widget = await client.turnstile.create({ name: "deparked-1", domains: ten });

    await expect(client.turnstile.updateHostnames(widget, [...ten, "one-more.example"])).rejects.toThrow(
      "update Turnstile hostnames failed: 400 too many domains (max: 10)",
    );
    expect(mock.state.widgets[0]?.domains).toEqual(ten);
  });

  it("siteverify uses the widget secret and reports the hostname", async () => {
    const { mock } = setup();
    const url = "https://mock.test/turnstile/v0/siteverify";
    mock.state.siteverify.hostname = "example.org";

    const passed = await verifyTurnstile({
      secret: TURNSTILE_DUMMY_SECRET_PASS,
      response: "token",
      fetch: mock.fetch,
      url,
    });
    expect(passed).toMatchObject({ success: true, hostname: "example.org", errorCodes: [] });
    expect(mock.callsTo("turnstile.siteverify")[0]?.body).toEqual({
      secret: TURNSTILE_DUMMY_SECRET_PASS,
      response: "token",
    });

    const failed = await verifyTurnstile({
      secret: TURNSTILE_DUMMY_SECRET_FAIL,
      response: "token",
      remoteIp: "203.0.113.5",
      fetch: mock.fetch,
      url,
    });
    expect(failed).toMatchObject({ success: false, hostname: undefined, errorCodes: ["invalid-input-secret"] });
  });

  it("siteverify throws when the service gives no usable answer", async () => {
    await expect(
      verifyTurnstile({ secret: "s", response: "t", fetch: async () => new Response("oops", { status: 500 }) }),
    ).rejects.toThrow("verify Turnstile token failed: 500 unexpected response");
  });
});

describe("Web Analytics", () => {
  it("creates, lists and deletes sites", async () => {
    const { mock, client } = setup();
    const site = await client.analytics.createSite("example.com");
    expect(site).toMatchObject({ host: "example.com" });
    expect(site.siteToken).toBeTypeOf("string");
    expect(mock.callsTo("analytics.createSite")[0]?.body).toEqual({ host: "example.com", auto_install: false });
    expect(await client.analytics.listSites()).toEqual([site]);

    await client.analytics.deleteSite(site.siteTag);
    expect(await client.analytics.listSites()).toEqual([]);
  });

  it("reports visits per host and day, referrers and countries in one request", async () => {
    const { mock, client } = setup();
    const row = { siteTag: "tag-a", host: "example.com", referrer: "news.example", country: "AT" };
    mock.state.analytics.push(
      { ...row, date: "2026-11-01", visits: 3 },
      { ...row, date: "2026-11-02", visits: 5, country: "DE" },
      { ...row, date: "2026-10-01", visits: 100 },
      { ...row, siteTag: "tag-b", host: "example.org", date: "2026-11-01", visits: 7 },
    );

    const report = await client.analytics.report({ siteTags: ["tag-a"], from: "2026-11-01", to: "2026-11-30" });
    expect(report).toEqual({
      visitsByDay: [
        { date: "2026-11-01", host: "example.com", visits: 3 },
        { date: "2026-11-02", host: "example.com", visits: 5 },
      ],
      referrers: [{ host: "news.example", visits: 8 }],
      countries: [
        { country: "DE", visits: 5 },
        { country: "AT", visits: 3 },
      ],
    });
    expect(client.requestCount).toBe(1);
  });

  it("turns a GraphQL error into a named error", async () => {
    const { client } = setup(
      {},
      { fetch: async () => Response.json({ data: null, errors: [{ message: "unknown field" }] }) },
    );
    await expect(client.analytics.report({ siteTags: [], from: "2026-11-01", to: "2026-11-02" })).rejects.toThrow(
      "read Web Analytics failed: 200 unknown field",
    );
  });
});

describe("Email Routing", () => {
  it("adds a notify address as pending, sees it verified, and deletes it", async () => {
    const { mock, client } = setup();
    const added = await client.email.createAddress("owner@example.com");
    expect(added).toMatchObject({ email: "owner@example.com", verifiedAt: null });

    mock.verifyAddress("owner@example.com");
    const [listed] = await client.email.listAddresses();
    expect(listed?.verifiedAt).toBeTypeOf("string");

    await client.email.deleteAddress(added.id);
    expect(await client.email.listAddresses()).toEqual([]);
  });

  it("reads a zone's Email Routing state and enables it", async () => {
    const { client } = setup();
    expect(await client.email.getRouting(ZONE.id)).toEqual({
      name: "example.com",
      enabled: false,
      status: "unconfigured",
    });
    expect(await client.email.enableRouting(ZONE.id)).toMatchObject({ enabled: true });

    const mx = await client.zones.listDnsRecords(ZONE.id, { type: "MX", name: "example.com" });
    expect(classifyMx(mx)).toBe("cloudflare");
  });

  it("classifies apex MX records: none, Cloudflare's, or someone else's mail", () => {
    expect(classifyMx([])).toBe("none");
    expect(classifyMx([{ type: "A", content: "192.0.2.1" }])).toBe("none");
    expect(classifyMx([{ type: "MX", content: "route1.mx.cloudflare.net." }])).toBe("cloudflare");
    expect(
      classifyMx([
        { type: "MX", content: "route1.mx.cloudflare.net" },
        { type: "MX", content: "aspmx.l.google.com" },
      ]),
    ).toBe("external");
    expect(classifyMx([{ type: "MX", content: "evilmx.cloudflare.net.example.com" }])).toBe("external");
  });
});
