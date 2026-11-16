import { describe, expect, it } from "vitest";
import { planAttachDomain } from "./attach";
import { inspectDomain } from "./inspect";
import { runPlan, setup, ZONE } from "./test-helpers";

const HOST = "example.com";

describe("looking at a domain before attaching it", () => {
  it("says in plain words that a site is live and will stay untouched", async () => {
    const { ctx, cf, mock } = await setup({
      dnsRecords: {
        [ZONE.id]: [
          { id: "a-apex", type: "A", name: HOST, content: "192.0.2.10", proxied: true },
          { id: "a-www", type: "CNAME", name: `www.${HOST}`, content: HOST, proxied: true },
          { id: "a-blog", type: "A", name: `blog.${HOST}`, content: "192.0.2.11", proxied: true },
        ],
      },
    });
    await cf.zones.createRoute(ZONE.id, { pattern: "example.com/shop*", script: "shop" });
    await cf.zones.createRoute(ZONE.id, { pattern: "blog.example.com/*", script: "blog" });
    await cf.rulesets.addRule(ZONE.id, "http_request_transform", {
      action: "rewrite",
      description: "old paths",
      expression: 'starts_with(http.request.uri.path, "/old/")',
      action_parameters: { uri: { path: { value: "/new" } } },
    });
    mock.calls.length = 0;

    const inspection = await inspectDomain(ctx, HOST);
    expect(inspection).toMatchObject({
      host: HOST,
      zone: { id: ZONE.id, name: HOST },
      managed: null,
      routes: [{ pattern: "example.com/shop*", script: "shop" }],
      sameRoutePatterns: [],
      dns: { apex: [{ id: "a-apex" }], www: [{ id: "a-www" }] },
      mx: { state: "none" },
      rules: { rewrite: [{ description: "old paths" }], redirect: [] },
      servesWebsite: true,
      blockers: [],
    });
    expect(inspection.summary).toBe(
      "example.com shows a website today. Deparked will take over the address: visitors get the for-sale page instead. Your site and its settings stay untouched, and Turn off brings it back. example.com/shop* keeps going to your Worker shop. example.com has no email set up. Deparked will turn on Cloudflare's email service for it, so offers can be sent from this domain.",
    );
    expect(mock.calls.every((call) => call.method === "GET")).toBe(true);
    expect(mock.calls).toHaveLength(9);
  });

  it("says that an empty domain shows nothing today", async () => {
    const { ctx } = await setup();
    const inspection = await inspectDomain(ctx, HOST);
    expect(inspection.servesWebsite).toBe(false);
    expect(inspection.summary).toContain("example.com shows nothing today.");
  });

  it("names a route Deparked would have to take over", async () => {
    const { ctx, cf } = await setup();
    await cf.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "my-site" });
    const inspection = await inspectDomain(ctx, HOST);
    expect(inspection.sameRoutePatterns).toMatchObject([{ pattern: "example.com/*", script: "my-site" }]);
    expect(inspection.servesWebsite).toBe(true);
    expect(inspection.summary).toContain("Another Worker already answers on example.com/*.");
  });

  it("explains that only whole domains can be attached", async () => {
    const { ctx } = await setup();
    const inspection = await inspectDomain(ctx, "shop.example.com");
    expect(inspection).toMatchObject({ zone: null, parentZone: "example.com" });
    expect(inspection.summary).toBe(
      "shop.example.com is a part of example.com. For now Deparked attaches whole domains only: pick example.com instead.",
    );
    const [report] = await runPlan(planAttachDomain(ctx, "shop.example.com"));
    expect(report).toMatchObject({ outcome: "blocked", message: inspection.summary });
  });

  it("explains that a domain must be on Cloudflare first", async () => {
    const { ctx, mock } = await setup();
    const inspection = await inspectDomain(ctx, "example.org");
    expect(inspection.blockers).toEqual([
      "example.org is not in this Cloudflare account. Add it to Cloudflare first, then come back.",
    ]);
    const [report] = await runPlan(planAttachDomain(ctx, "example.org"));
    expect(report?.outcome).toBe("blocked");
    expect(mock.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("does not count what Deparked itself added as the owner's site", async () => {
    const { ctx } = await setup();
    await runPlan(planAttachDomain(ctx, HOST));
    const inspection = await inspectDomain(ctx, HOST);
    expect(inspection).toMatchObject({
      managed: "placeholder",
      routes: [],
      dns: { apex: [], www: [] },
      rules: { rewrite: [], redirect: [] },
      servesWebsite: false,
      mx: { state: "cloudflare" },
    });
    expect(inspection.summary).toContain("example.com is already set up in Deparked.");
  });
});

describe("redirects set up outside Deparked", () => {
  const blockersFor = async (seed: (context: Awaited<ReturnType<typeof setup>>) => unknown) => {
    const context = await setup();
    await seed(context);
    return (await inspectDomain(context.ctx, HOST)).blockers;
  };

  it("blocks on a redirect rule for every hostname of the zone, naming where to delete it", async () => {
    const blockers = await blockersFor(({ cf }) =>
      cf.rulesets.addRule(ZONE.id, "http_request_dynamic_redirect", {
        action: "redirect",
        description: "to my site",
        expression: "true",
        action_parameters: { from_value: { status_code: 301, target_url: { value: "https://elsewhere.example" } } },
      }),
    );
    expect(blockers).toEqual([expect.stringContaining('The redirect rule "to my site"')]);
    expect(blockers[0]).toContain("Rules → Redirect Rules");
  });

  it("leaves a redirect rule for another hostname of the zone alone", async () => {
    const blockers = await blockersFor(({ cf }) =>
      cf.rulesets.addRule(ZONE.id, "http_request_dynamic_redirect", {
        action: "redirect",
        description: "old blog",
        expression: 'http.host eq "blog.example.com"',
        action_parameters: { from_value: { status_code: 301, target_url: { value: "https://elsewhere.example" } } },
      }),
    );
    expect(blockers).toEqual([]);
  });

  it("blocks on a forwarding page rule for the domain or its www", async () => {
    const blockers = await blockersFor(({ mock }) => {
      mock.state.pageRules.set(ZONE.id, [
        {
          id: "pr-1",
          status: "active",
          targets: [{ target: "url", constraint: { operator: "matches", value: "*example.com/*" } }],
          actions: [{ id: "forwarding_url", value: { url: "https://elsewhere.example/$2", status_code: 301 } }],
        },
        {
          id: "pr-2",
          status: "active",
          targets: [{ target: "url", constraint: { operator: "matches", value: "shop.example.org/*" } }],
          actions: [{ id: "forwarding_url", value: { url: "https://elsewhere.example", status_code: 301 } }],
        },
      ]);
    });
    expect(blockers).toEqual([expect.stringContaining("The page rule for *example.com/*")]);
  });

  it("blocks on a bulk redirect whose source is the domain", async () => {
    const blockers = await blockersFor(({ mock }) => {
      mock.state.bulkRedirects.push(
        { list: "moves", source_url: "example.com/", target_url: "https://elsewhere.example/" },
        { list: "moves", source_url: "other.example/", target_url: "https://elsewhere.example/" },
      );
    });
    expect(blockers).toEqual([expect.stringContaining('The bulk redirect example.com/ in the list "moves"')]);
  });
});
