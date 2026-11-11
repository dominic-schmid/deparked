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
    expect(read.message).toBe("read zone failed: no response network error");
    expect(sent).toBe(3);

    sent = 0;
    await failure(() => client.zones.createRoute(ZONE.id, { pattern: "example.com/*", script: "s" }));
    expect(sent).toBe(1);
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
