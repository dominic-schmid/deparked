import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CloudflareApiError, createCloudflareClient } from "./index";
import { setup, TOKEN, ZONE } from "./testing";

async function failure(run: () => Promise<unknown>): Promise<CloudflareApiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CloudflareApiError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("retries", () => {
  it("retries a 5xx with growing backoff and then succeeds", async () => {
    const { mock, client, sleeps } = setup();
    mock.failNext({ route: "zones.get", status: 502, times: 2 });

    await expect(client.zones.get(ZONE.id)).resolves.toMatchObject({ name: "example.com" });
    expect(sleeps).toEqual([250, 500]);
    expect(client.requestCount).toBe(3);
  });

  it("adds jitter: a wait is between half and all of the backoff step", async () => {
    const { mock, client, sleeps } = setup({}, { random: () => 0 });
    mock.failNext({ route: "zones.get", status: 500 });

    await client.zones.get(ZONE.id);
    expect(sleeps).toEqual([125]);
  });

  it("honours Retry-After on a 429, capped at maxDelayMs", async () => {
    const { mock, client, sleeps } = setup({}, { maxDelayMs: 5000 });
    mock.failNext({ route: "zones.get", status: 429, retryAfterSeconds: 2 });
    mock.failNext({ route: "zones.get", nth: 2, status: 429, retryAfterSeconds: 60 });

    await client.zones.get(ZONE.id);
    expect(sleeps).toEqual([2000, 5000]);
  });

  it("gives up after maxAttempts and reports how many it made", async () => {
    const { mock, client } = setup({}, { maxAttempts: 2 });
    mock.failNext({ route: "zones.get", status: 503, times: 5 });

    const error = await failure(() => client.zones.get(ZONE.id));
    expect(error.status).toBe(503);
    expect(error.attempts).toBe(2);
    expect(client.requestCount).toBe(2);
  });

  it("does not retry a 4xx", async () => {
    const { mock, client, sleeps } = setup();
    mock.failNext({ route: "zones.get", status: 403, times: 5 });

    await failure(() => client.zones.get(ZONE.id));
    expect(sleeps).toEqual([]);
    expect(client.requestCount).toBe(1);
  });

  it("retries a GET that got no response, but not a POST", async () => {
    let sent = 0;
    const client = createCloudflareClient({
      token: TOKEN,
      accountId: "a",
      sleep: async () => {},
      fetch: async () => {
        sent += 1;
        throw new TypeError(`connect failed with ${TOKEN}`);
      },
    });

    const read = await failure(() => client.zones.get(ZONE.id));
    expect(read.message).toBe("read zone failed: no response (network error or timeout)");
    expect(read.status).toBe(0);
    expect(sent).toBe(3);

    sent = 0;
    await failure(() => client.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "s" }));
    expect(sent).toBe(1);
  });
});

describe("requests that are not safe to send twice", () => {
  const route = { pattern: "example.com/*", script: "deparked-test-sites" };

  it("does not re-send a create on 5xx: Cloudflare may have applied it", async () => {
    const { mock, client, sleeps } = setup();
    mock.failNext({ route: "routes.create", status: 502 });
    mock.failNext({ route: "rulesets.create", status: 500 });
    mock.failNext({ route: "d1.query", status: 503 });

    await failure(() => client.zones.createRoute(ZONE.id, route));
    await failure(() =>
      client.rulesets.addRule(ZONE.id, "http_request_transform", {
        action: "rewrite",
        description: "deparked",
        expression: "true",
        action_parameters: { uri: { path: { value: "/" } } },
      }),
    );
    await failure(() => client.d1.query("db", "INSERT INTO t VALUES (1)"));
    expect(sleeps).toEqual([]);
    expect(mock.callsTo("routes.create")).toHaveLength(1);
    expect(mock.callsTo("rulesets.create")).toHaveLength(1);
    expect(mock.callsTo("d1.query")).toHaveLength(1);
  });

  it("re-sends a create on 429, which Cloudflare did not process", async () => {
    const { mock, client } = setup();
    mock.failNext({ route: "routes.create", status: 429, retryAfterSeconds: 1 });

    await client.zones.createRoute(ZONE.id, route);
    expect(mock.callsTo("routes.create")).toHaveLength(2);
    expect(mock.state.routes.get(ZONE.id)).toHaveLength(1);
  });

  it("still retries PUT and DELETE on 5xx, and the content-addressed assets upload", async () => {
    const { mock, client } = setup();
    const created = await client.zones.createRoute(ZONE.id, route);
    mock.failNext({ route: "routes.delete", status: 500 });
    mock.failNext({ route: "workers.uploadScript", status: 502 });
    mock.failNext({ route: "workers.assetsUploadSession", status: 503 });

    await client.zones.deleteRoute(ZONE.id, created.id);
    const { completionJwt } = await client.workers.uploadAssets({
      scriptName: "deparked-test-sites",
      manifest: {},
      read: async () => ({ content: new Uint8Array(), contentType: "text/html" }),
    });
    await client.workers.uploadScript("deparked-test-sites", {
      compatibilityDate: "2026-11-01",
      assets: { jwt: completionJwt },
    });
    expect(mock.callsTo("routes.delete")).toHaveLength(2);
    expect(mock.callsTo("workers.uploadScript")).toHaveLength(2);
    expect(mock.callsTo("workers.assetsUploadSession")).toHaveLength(2);
  });
});

describe("timeouts", () => {
  it("aborts an attempt that hangs and reports no response", async () => {
    let sent = 0;
    const client = createCloudflareClient({
      token: TOKEN,
      accountId: "a",
      timeoutMs: 5,
      sleep: async () => {},
      fetch: (_url, init) => {
        sent += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      },
    });

    const error = await failure(() => client.accounts.get());
    expect(error.message).toBe("read account failed: no response (network error or timeout)");
    expect(sent).toBe(3);
  });
});

describe("path segments", () => {
  it.each(["x/../../zones/y", "a?b", "..", "", "a b", "a%2Fb"])("refuses %j before sending anything", async (bad) => {
    const { mock, client } = setup();
    const calls = [
      () => client.zones.get(bad),
      () => client.zones.deleteRoute(ZONE.id, bad),
      () => client.rulesets.deleteRule(ZONE.id, bad, "rule"),
      () => client.rulesets.deleteRule(ZONE.id, "ruleset", bad),
      () => client.workers.getSettings(bad),
      () => client.workers.putSecret("deparked-test-admin", bad, "value-1234"),
      () => client.workers.deleteSecret("deparked-test-admin", bad),
      () => client.workers.deployVersion(bad, "version"),
      () => client.d1.query(bad, "SELECT 1"),
      () => client.turnstile.getSecret(bad),
      () => client.turnstile.delete(bad),
      () => client.analytics.deleteSite(bad),
      () => client.email.deleteAddress(bad),
      () => client.email.getRouting(bad),
      () => client.email.enableRouting({ id: bad, name: "example.com" }, { replaceExistingMx: false }),
      () => client.tokens.probePermissions({ zoneId: bad }),
    ];
    for (const call of calls) {
      const error = await failure(async () => call());
      expect(error.message).toBe("build API path failed: an id or name has characters not allowed in a path");
    }
    expect(mock.calls).toEqual([]);
    expect(() => createCloudflareClient({ token: TOKEN, accountId: bad })).toThrow("build API path failed");
  });

  it("accepts the ids and names Cloudflare uses", async () => {
    const { client } = setup();
    await expect(client.workers.getSettings("deparked-test_admin.v2")).resolves.toBeNull();
  });
});

describe("errors", () => {
  it("names the call and carries the status and Cloudflare's error codes", async () => {
    const { mock, client } = setup();
    mock.denyPermission("routes");

    const error = await failure(() => client.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "s" }));
    expect(error.message).toBe("create Worker route failed: 403 Authentication error (code 10000)");
    expect(error.call).toBe("create Worker route");
    expect(error.status).toBe(403);
    expect(error.codes).toEqual([10000]);
  });

  it("never shows the token, a secret or an upload token, even when Cloudflare echoes them", async () => {
    const { mock, client } = setup();
    await client.workers.uploadScript("deparked-test-admin", {
      mainModule: "index.js",
      modules: [{ name: "index.js", content: "export default {}" }],
      compatibilityDate: "2026-11-01",
    });
    const secret = "s3cret-session-key";
    mock.failNext({ route: "workers.putSecret", status: 400, message: `bad request: ${TOKEN} ${secret}` });

    const error = await failure(() => client.workers.putSecret("deparked-test-admin", "SESSION_KEY", secret));
    expect(error.message).toBe(
      "set Worker secret SESSION_KEY failed: 400 bad request: [redacted] [redacted] (code 10000)",
    );
    expect(JSON.stringify(error.errors)).not.toContain(TOKEN);
    expect(JSON.stringify(error.errors)).not.toContain(secret);
  });

  it("hides an assets completion token passed to an upload", async () => {
    const { mock, client } = setup();
    const jwt = "completion-token-that-is-not-valid";
    mock.failNext({ route: "workers.uploadScript", status: 400, message: `bad token ${jwt}` });

    const error = await failure(() =>
      client.workers.uploadScript("deparked-test-sites", { compatibilityDate: "2026-11-01", assets: { jwt } }),
    );
    expect(error.message).toBe("upload Worker deparked-test-sites failed: 400 bad token [redacted] (code 10000)");
  });

  it("does not redact values under 8 characters, which would garble messages", async () => {
    const { mock, client } = setup();
    await client.workers.uploadScript("deparked-test-admin", { compatibilityDate: "2026-11-01" });
    mock.failNext({ route: "workers.putSecret", status: 400, message: "a bad request" });

    const error = await failure(() => client.workers.putSecret("deparked-test-admin", "FLAG", "a"));
    expect(error.message).toBe("set Worker secret FLAG failed: 400 a bad request (code 10000)");
  });

  it("keeps a bounded list of hidden values and always hides the API token", async () => {
    const { mock, client } = setup();
    await client.workers.uploadScript("deparked-test-admin", { compatibilityDate: "2026-11-01" });
    for (let index = 0; index < 70; index += 1) {
      await client.workers.putSecret("deparked-test-admin", "KEY", `secret-value-${index}`);
    }
    mock.failNext({ route: "zones.get", status: 400, message: `${TOKEN} secret-value-69 secret-value-0!` });

    const error = await failure(() => client.zones.get(ZONE.id));
    expect(error.message).toBe("read zone failed: 400 [redacted] [redacted] secret-value-0! (code 10000)");
  });

  it("reports a non-JSON answer without its body", async () => {
    const client = createCloudflareClient({
      token: TOKEN,
      accountId: "a",
      maxAttempts: 1,
      fetch: async () => new Response("<html>bad gateway</html>", { status: 502 }),
    });

    const error = await failure(() => client.accounts.get());
    expect(error.message).toBe("read account failed: 502 response was not JSON");
  });

  it("rejects a response that lacks a field the client uses", async () => {
    const client = createCloudflareClient({
      token: TOKEN,
      accountId: "a",
      fetch: async () => Response.json({ success: true, errors: [], result: { name: "no id" } }),
    });

    const error = await failure(() => client.accounts.get());
    expect(error.message).toContain("read account failed: 200 unexpected response shape (id:");
  });
});

describe("pagination", () => {
  it("follows pages until the last one, one request per page", async () => {
    const zones = Array.from({ length: 120 }, (_, index) => ({ id: `zone-${index}`, name: `site-${index}.example` }));
    const { mock, client } = setup({ zones });

    const listed = await client.zones.list();
    expect(listed).toHaveLength(120);
    expect(mock.callsTo("zones.list").map((call) => call.query.page)).toEqual(["1", "2", "3"]);
    expect(mock.callsTo("zones.list")[0]?.query["account.id"]).toBe(mock.state.accountId);
  });

  it("trusts result_info over page length: a server-capped page is not the last one", async () => {
    const pages: number[] = [];
    const client = createCloudflareClient({
      token: TOKEN,
      accountId: "a",
      fetch: async (url) => {
        const page = Number(new URL(url).searchParams.get("page"));
        pages.push(page);
        const result = [
          { id: `z${page}a`, name: "a.example" },
          { id: `z${page}b`, name: "b.example" },
        ];
        return Response.json({ success: true, errors: [], result, result_info: { total_count: 6 } });
      },
    });

    expect(await client.zones.list({}, { perPage: 50 })).toHaveLength(6);
    expect(pages).toEqual([1, 2, 3]);
  });

  it("stops with an error at maxPages instead of using up the subrequest budget", async () => {
    const zones = Array.from({ length: 30 }, (_, index) => ({ id: `zone-${index}`, name: `site-${index}.example` }));
    const { client } = setup({ zones });

    const error = await failure(() => client.zones.list({}, { perPage: 10, maxPages: 2 }));
    expect(error.message).toBe("list zones failed: 200 more than 2 pages of results");
    expect(client.requestCount).toBe(2);
  });
});

describe("runtime", () => {
  it("keeps Node APIs out of the client, so it bundles for workerd", () => {
    const files = readdirSync(import.meta.dirname).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "testing.ts",
    );
    expect(files).toContain("workers.ts");
    for (const file of files) {
      const source = readFileSync(`${import.meta.dirname}/${file}`, "utf8");
      expect(source, file).not.toMatch(/from "node:|\bBuffer\b|\bprocess\.|\/mock"/);
    }
  });
});
