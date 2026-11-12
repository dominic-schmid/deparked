import { createCloudflareClient } from "@deparked/cf";
import {
  createMockCloudflare,
  type MockSeed,
  TURNSTILE_DUMMY_SECRET_FAIL,
  TURNSTILE_DUMMY_SECRET_PASS,
} from "@deparked/cf/mock";
import { contentHash, HostingError, type PublishFile } from "@deparked/hosting";
import { describe, expect, it } from "vitest";
import { type CloudflareHostingOptions, createCloudflareHosting, PUBLISH_FIXED_REQUESTS } from "./index";

const TOKEN = "test-token-never-shown";
const SITES = "deparked-test-sites";
const ADMIN = "deparked-test-admin";
const ZONE = { id: "zone-1", name: "example.com" };
const BASE_URL = "https://mock.test/client/v4";
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

class FakeEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: string;
  constructor(from: string, to: string, raw: string) {
    this.from = from;
    this.to = to;
    this.raw = raw;
  }
}

function setup(seed: MockSeed = {}, overrides: Partial<CloudflareHostingOptions> = {}) {
  const mock = createMockCloudflare({ token: TOKEN, zones: [ZONE], ...seed });
  const client = createCloudflareClient({
    token: TOKEN,
    accountId: mock.state.accountId,
    fetch: mock.fetch,
    baseUrl: BASE_URL,
    sleep: async () => {},
  });
  const sent: FakeEmailMessage[] = [];
  const secrets: Record<string, string> = {
    TURNSTILE_SECRET_1: TURNSTILE_DUMMY_SECRET_PASS,
    TURNSTILE_SECRET_BAD: TURNSTILE_DUMMY_SECRET_FAIL,
  };
  const hosting = createCloudflareHosting({
    client,
    sitesScriptName: SITES,
    adminScriptName: ADMIN,
    email: {
      binding: {
        send: async (message) => {
          sent.push(message as FakeEmailMessage);
        },
      },
      EmailMessage: FakeEmailMessage,
    },
    getSecret: (ref) => secrets[ref],
    fetch: mock.fetch,
    botCheckUrl: "https://mock.test/turnstile/v0/siteverify",
    now: () => new Date("2026-11-12T09:30:00Z"),
    ...overrides,
  } as CloudflareHostingOptions);
  return { mock, client, hosting, sent };
}

async function site(pages: Record<string, string>) {
  const files: PublishFile[] = [];
  for (const [path, body] of Object.entries(pages)) {
    const contentType = path.endsWith(".html") ? "text/html" : "font/woff2";
    files.push({ path, hash: await contentHash(path, encode(body)), size: encode(body).length, contentType });
  }
  const read: string[] = [];
  const getContent = async (path: string) => {
    read.push(path);
    return encode(pages[path] ?? "");
  };
  return { files, getContent, read };
}

const PAGES = {
  "/sites/a.example/index.html": "<h1>a.example is for sale</h1>",
  "/sites/b.example/index.html": "<h1>b.example is for sale</h1>",
  "/catalog/font.woff2": "font bytes",
};

async function published<T extends { done: boolean }>(result: Promise<T>) {
  const value = await result;
  if (!value.done) throw new Error("publish did not finish");
  return value as Extract<T, { done: true }>;
}

describe("publish", () => {
  it("first publish sends every file and deploys an assets-only Worker", async () => {
    const { mock, hosting } = setup({ bucketSize: 2 });
    const first = await site(PAGES);

    const result = await published(hosting.publish(first));

    expect(result.uploaded.sort()).toEqual(Object.keys(PAGES).sort());
    expect(result.requests).toBe(PUBLISH_FIXED_REQUESTS + 2);
    const served = mock.deployedAssets(SITES);
    expect(decode(served.get("/sites/a.example/index.html")?.body)).toBe(PAGES["/sites/a.example/index.html"]);
    expect(served.get("/catalog/font.woff2")?.contentType).toBe("font/woff2");
    const version = mock.state.scripts.get(SITES)?.versions[0];
    expect(version?.id).toBe(result.versionId);
    expect(version?.metadata).toMatchObject({
      assets: { config: { html_handling: "none", not_found_handling: "none" } },
    });
    expect(version?.metadata).not.toHaveProperty("main_module");
  });

  it("republishing an unchanged manifest uploads nothing and reads no content", async () => {
    const { mock, hosting } = setup();
    await hosting.publish(await site(PAGES));
    const again = await site(PAGES);

    const result = await published(hosting.publish(again));

    expect(result.uploaded).toEqual([]);
    expect(again.read).toEqual([]);
    expect(result.requests).toBe(PUBLISH_FIXED_REQUESTS);
    expect(mock.callsTo("workers.assetsUpload")).toHaveLength(1);
    expect(mock.deployedAssets(SITES).size).toBe(3);
  });

  it("one changed file: only that file is read and sent, the others stay served", async () => {
    const { mock, hosting } = setup();
    await hosting.publish(await site(PAGES));
    const changed = await site({ ...PAGES, "/sites/a.example/index.html": "<h1>new price</h1>" });

    const result = await published(hosting.publish(changed));

    expect(result.uploaded).toEqual(["/sites/a.example/index.html"]);
    expect(changed.read).toEqual(["/sites/a.example/index.html"]);
    const served = mock.deployedAssets(SITES);
    expect(decode(served.get("/sites/a.example/index.html")?.body)).toBe("<h1>new price</h1>");
    expect(decode(served.get("/sites/b.example/index.html")?.body)).toBe(PAGES["/sites/b.example/index.html"]);
  });

  it("stops at the batch limit without deploying, and the next call finishes the job", async () => {
    const { mock, hosting } = setup({ bucketSize: 1 });
    const pages = await site(PAGES);

    const partial = await hosting.publish({ ...pages, maxUploadBatches: 2 });

    expect(partial).toMatchObject({ done: false, pending: 1, requests: 3 });
    expect(partial.uploaded).toHaveLength(2);
    expect(mock.state.scripts.has(SITES)).toBe(false);

    const rest = await published(hosting.publish({ ...pages, maxUploadBatches: 2 }));
    expect(rest.uploaded).toHaveLength(1);
    expect([...partial.uploaded, ...rest.uploaded].sort()).toEqual(Object.keys(PAGES).sort());
    expect(mock.deployedAssets(SITES).size).toBe(3);
  });

  it("refuses content that is not the size the manifest lists", async () => {
    const { mock, hosting } = setup();
    const pages = await site(PAGES);
    await expect(hosting.publish({ ...pages, getContent: async () => encode("other") })).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(mock.state.scripts.has(SITES)).toBe(false);
  });

  it("lets the caller's own errors through untouched", async () => {
    const { hosting } = setup();
    const broken = new Error("render failed");
    const pages = await site(PAGES);
    await expect(
      hosting.publish({
        ...pages,
        getContent: async () => {
          throw broken;
        },
      }),
    ).rejects.toBe(broken);
  });

  it("rolls back to an earlier version and lists versions newest first", async () => {
    const { mock, hosting } = setup();
    const first = await published(hosting.publish(await site(PAGES)));
    const second = await published(
      hosting.publish(await site({ ...PAGES, "/sites/a.example/index.html": "<h1>new price</h1>" })),
    );
    expect(await hosting.listVersions()).toEqual([
      { id: second.versionId, createdAt: expect.any(String), live: true },
      { id: first.versionId, createdAt: expect.any(String), live: false },
    ]);

    expect(await hosting.rollback(first.versionId)).toEqual({ versionId: first.versionId });

    expect(decode(mock.deployedAssets(SITES).get("/sites/a.example/index.html")?.body)).toBe(
      PAGES["/sites/a.example/index.html"],
    );
    expect((await hosting.listVersions({ limit: 1 })).map((version) => version.live)).toEqual([false]);
    await expect(hosting.rollback("version-unknown")).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("credentials", () => {
  it("a revoked token is reported as rejected credentials, without the token in the message", async () => {
    const { mock, hosting } = setup();
    mock.state.token = "rotated-by-the-owner";

    const error = await hosting.publish(await site(PAGES)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HostingError);
    expect(error).toMatchObject({ code: "credentials-rejected", credentialsRejected: true, retryable: false });
    expect((error as HostingError).message).not.toContain(TOKEN);
    await expect(hosting.notifyAddresses.list()).rejects.toMatchObject({ credentialsRejected: true });
    await expect(hosting.listVersions()).rejects.toMatchObject({ credentialsRejected: true });
  });

  it("a token without a permission is reported the same way", async () => {
    const { mock, hosting } = setup();
    mock.denyPermission("analytics");
    await expect(
      hosting.readAnalytics({ sites: [{ host: "a.example", siteId: "s1" }], from: "2026-11-01", to: "2026-11-02" }),
    ).rejects.toMatchObject({ credentialsRejected: true });
  });

  it("an expired upload session is not blamed on the token", async () => {
    const { mock, hosting } = setup();
    mock.failNext({ route: "workers.assetsUpload", status: 401, message: "session expired" });
    await expect(hosting.publish(await site(PAGES))).rejects.toMatchObject({
      code: "failed",
      credentialsRejected: false,
    });
  });

  it("an outage is retryable and not a credentials problem", async () => {
    const { mock, hosting } = setup();
    mock.failNext({ route: "email.listAddresses", status: 503, times: 5 });
    await expect(hosting.notifyAddresses.list()).rejects.toMatchObject({ code: "unavailable", retryable: true });
  });

  it("builds its own client from a token and account id", async () => {
    const mock = createMockCloudflare({ token: TOKEN });
    const hosting = createCloudflareHosting({
      token: TOKEN,
      accountId: mock.state.accountId,
      baseUrl: BASE_URL,
      fetch: mock.fetch,
      sitesScriptName: SITES,
      getSecret: () => undefined,
    });
    expect((await published(hosting.publish(await site(PAGES)))).uploaded).toHaveLength(3);
  });
});

describe("verifyBotCheck", () => {
  const input = { token: "visitor-token", host: "example.com", secretRef: "TURNSTILE_SECRET_1" };

  it("accepts a valid token solved on the domain, whatever the case of the host", async () => {
    const { mock, hosting } = setup();
    expect(await hosting.verifyBotCheck({ ...input, host: "Example.com", remoteIp: "203.0.113.7" })).toEqual({
      ok: true,
    });
    expect(mock.callsTo("turnstile.siteverify")[0]?.body).toEqual({
      secret: TURNSTILE_DUMMY_SECRET_PASS,
      response: "visitor-token",
      remoteip: "203.0.113.7",
    });
  });

  it("refuses a token solved on another hostname", async () => {
    const { mock, hosting } = setup();
    mock.state.siteverify.hostname = "attacker.example";
    expect(await hosting.verifyBotCheck(input)).toEqual({ ok: false, reason: "wrong-host" });
  });

  it("refuses a bad token, and an empty one without asking Cloudflare", async () => {
    const { mock, hosting } = setup();
    mock.state.siteverify.success = false;
    expect(await hosting.verifyBotCheck(input)).toEqual({ ok: false, reason: "rejected" });
    expect(await hosting.verifyBotCheck({ ...input, token: " " })).toEqual({ ok: false, reason: "rejected" });
    expect(mock.callsTo("turnstile.siteverify")).toHaveLength(1);
  });

  it("says so when the secret is missing or refused", async () => {
    const { hosting } = setup();
    const notConfigured = { ok: false, reason: "not-configured" };
    expect(await hosting.verifyBotCheck({ ...input, secretRef: "TURNSTILE_SECRET_9" })).toEqual(notConfigured);
    expect(await hosting.verifyBotCheck({ ...input, secretRef: "TURNSTILE_SECRET_BAD" })).toEqual(notConfigured);
  });

  it("throws when the check could not run", async () => {
    const { hosting } = setup(
      {},
      {
        fetch: async () => {
          throw new Error("offline");
        },
      },
    );
    await expect(hosting.verifyBotCheck(input)).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("sendNotification", () => {
  const message = {
    senderHost: "example.com",
    fromName: "Deparked",
    to: "owner@example.com",
    replyTo: { email: "buyer@example.org", name: "Ada Buyer" },
    subject: "New offer for example.com",
    text: "Ada offers 1,500 EUR.",
  };

  it("hands the binding a message from offers@<senderHost> with Reply-To set to the buyer", async () => {
    const { hosting, sent } = setup();
    await hosting.sendNotification(message);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(FakeEmailMessage);
    expect(sent[0]).toMatchObject({ from: "offers@example.com", to: "owner@example.com" });
    const raw = sent[0]?.raw ?? "";
    expect(raw).toContain('From: "Deparked" <offers@example.com>\r\n');
    expect(raw).toContain("To: owner@example.com\r\n");
    expect(raw).toContain('Reply-To: "Ada Buyer" <buyer@example.org>\r\n');
    expect(raw).toContain("Date: Thu, 12 Nov 2026 09:30:00 +0000\r\n");
    expect(raw).toMatch(/Message-ID: <[0-9a-f-]{36}@example\.com>\r\n/);
  });

  it("refuses buyer input that tries to add a recipient, before anything is sent", async () => {
    const { hosting, sent } = setup();
    await expect(
      hosting.sendNotification({ ...message, replyTo: { email: "buyer@example.org\r\nBcc: victim@example.net" } }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(hosting.sendNotification({ ...message, senderHost: "example.com\r\nBcc: x" })).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(sent).toEqual([]);
  });

  it("reports a refused send without repeating the binding's message", async () => {
    const cause = new Error("destination buyer@example.org rejected");
    const { hosting } = setup(
      {},
      {
        email: {
          binding: {
            send: async () => {
              throw cause;
            },
          },
          EmailMessage: FakeEmailMessage,
        },
      },
    );
    const error = await hosting.sendNotification(message).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "failed", cause });
    expect((error as HostingError).message).not.toContain("buyer@example.org");
  });
});

describe("readAnalytics", () => {
  it("maps visits per day, referrers and countries for the sites asked for", async () => {
    const { mock, hosting } = setup();
    mock.state.analytics.push(
      { siteTag: "s1", date: "2026-11-01", host: "a.example", referrer: "news.example", country: "Austria", visits: 3 },
      { siteTag: "s1", date: "2026-11-02", host: "a.example", referrer: "", country: "Germany", visits: 5 },
      { siteTag: "s2", date: "2026-11-02", host: "b.example", referrer: "", country: "Germany", visits: 7 },
      { siteTag: "s1", date: "2026-10-31", host: "a.example", referrer: "", country: "Germany", visits: 100 },
      { siteTag: "s3", date: "2026-11-02", host: "c.example", referrer: "", country: "Italy", visits: 100 },
    );

    const report = await hosting.readAnalytics({
      sites: [
        { host: "a.example", siteId: "s1" },
        { host: "b.example", siteId: "s2" },
      ],
      from: "2026-11-01",
      to: "2026-11-30",
    });

    expect(report).toEqual({
      visitsByDay: [
        { date: "2026-11-01", host: "a.example", visits: 3 },
        { date: "2026-11-02", host: "b.example", visits: 7 },
        { date: "2026-11-02", host: "a.example", visits: 5 },
      ],
      referrers: [
        { host: "", visits: 12 },
        { host: "news.example", visits: 3 },
      ],
      countries: [
        { country: "Germany", visits: 12 },
        { country: "Austria", visits: 3 },
      ],
      totalVisits: 15,
    });
    expect(mock.callsTo("analytics.graphql")).toHaveLength(1);
  });

  it("answers an empty report for no sites without a request, and refuses a bad range", async () => {
    const { mock, hosting } = setup();
    expect(await hosting.readAnalytics({ sites: [], from: "2026-11-01", to: "2026-11-02" })).toEqual({
      visitsByDay: [],
      referrers: [],
      countries: [],
      totalVisits: 0,
    });
    const sites = [{ host: "a.example", siteId: "s1" }];
    await expect(hosting.readAnalytics({ sites, from: "2026-11-03", to: "2026-11-02" })).rejects.toMatchObject({
      code: "invalid-input",
    });
    await expect(hosting.readAnalytics({ sites, from: "yesterday", to: "2026-11-02" })).rejects.toThrow(HostingError);
    expect(mock.calls).toEqual([]);
  });
});

describe("notifyAddresses", () => {
  it("add, verify, list and remove", async () => {
    const { mock, hosting } = setup();

    const added = await hosting.notifyAddresses.add("owner@example.com");
    expect(added).toEqual({ id: expect.any(String), email: "owner@example.com", verified: false, verifiedAt: null });
    expect(await hosting.notifyAddresses.add("Owner@example.com")).toEqual(added);
    expect(mock.state.addresses).toHaveLength(1);

    mock.verifyAddress("owner@example.com");
    expect(await hosting.notifyAddresses.list()).toEqual([
      { ...added, verified: true, verifiedAt: expect.any(String) },
    ]);

    await hosting.notifyAddresses.remove(added.id);
    await hosting.notifyAddresses.remove(added.id);
    expect(await hosting.notifyAddresses.list()).toEqual([]);
  });

  it("resend re-adds a pending address under a new id and leaves a verified one alone", async () => {
    const { mock, hosting } = setup();
    const added = await hosting.notifyAddresses.add("owner@example.com");

    const resent = await hosting.notifyAddresses.resend(added.id);
    expect(resent).toMatchObject({ email: "owner@example.com", verified: false });
    expect(resent.id).not.toBe(added.id);
    expect(mock.callsTo("email.createAddress")).toHaveLength(2);

    mock.verifyAddress("owner@example.com");
    expect(await hosting.notifyAddresses.resend(resent.id)).toMatchObject({ id: resent.id, verified: true });
    expect(mock.callsTo("email.createAddress")).toHaveLength(2);
    await expect(hosting.notifyAddresses.resend(added.id)).rejects.toMatchObject({ code: "not-found" });
  });

  it("refuses something that is not an email address without a request", async () => {
    const { mock, hosting } = setup();
    await expect(hosting.notifyAddresses.add("not an address")).rejects.toMatchObject({ code: "invalid-input" });
    expect(mock.calls).toEqual([]);
  });
});

describe("routes", () => {
  it("adds routes to both Workers once, lists them by target and removes them", async () => {
    const { mock, hosting } = setup();
    const pages = await hosting.routes.add(ZONE.id, { pattern: "example.com/*", target: "sites" });
    const admin = await hosting.routes.add(ZONE.id, { pattern: "example.com/admin*", target: "admin" });
    expect(await hosting.routes.add(ZONE.id, { pattern: "example.com/*", target: "sites" })).toEqual(pages);
    expect(mock.state.routes.get(ZONE.id)).toEqual([
      { id: pages.id, pattern: "example.com/*", script: SITES },
      { id: admin.id, pattern: "example.com/admin*", script: ADMIN },
    ]);
    expect(await hosting.routes.list(ZONE.id)).toEqual([
      { id: pages.id, pattern: "example.com/*", target: "sites" },
      { id: admin.id, pattern: "example.com/admin*", target: "admin" },
    ]);

    await hosting.routes.remove(ZONE.id, pages.id);
    await hosting.routes.remove(ZONE.id, pages.id);
    expect(await hosting.routes.list(ZONE.id)).toEqual([
      { id: admin.id, pattern: "example.com/admin*", target: "admin" },
    ]);
  });

  it("never takes over a pattern that points somewhere else", async () => {
    const { mock, hosting } = setup();
    mock.state.routes.set(ZONE.id, [{ id: "route-existing", pattern: "example.com/*", script: "someone-elses-site" }]);
    expect(await hosting.routes.list(ZONE.id)).toEqual([
      { id: "route-existing", pattern: "example.com/*", target: "other" },
    ]);
    await expect(hosting.routes.add(ZONE.id, { pattern: "example.com/*", target: "sites" })).rejects.toMatchObject({
      code: "conflict",
    });
    expect(mock.callsTo("routes.create")).toEqual([]);
  });
});
