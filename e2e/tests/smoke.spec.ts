import { createCloudflareClient } from "@deparked/cf";
import { expect, TEST_ACCOUNT_ID, TEST_TOKEN, test } from "../fixtures";

test("the admin answers on /admin", async ({ request, urls }) => {
  const response = await request.get(`${urls.admin}/admin`);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(await response.text()).toContain("Deparked");
});

test("the installer answers on /health", async ({ request, urls }) => {
  const response = await request.get(`${urls.install}/health`);
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true, worker: "deparked-install" });
});

test("a managed domain reaches its lander, the catalog and the admin through the host proxy", async ({
  page,
  hostUrl,
  writeSiteFile,
}) => {
  await writeSiteFile(
    "sites/example.com/index.html",
    "<!doctype html><title>e2e</title><h1>example.com is for sale</h1>",
  );
  await writeSiteFile("catalog/e2e-probe.txt", "catalog probe");

  await page.goto(hostUrl("example.com"));
  await expect(page.getByRole("heading", { name: "example.com is for sale" })).toBeVisible();

  // Same-origin, from the page: only Chromium resolves *.localhost everywhere, Node may not.
  const catalog = await page.evaluate(() => fetch("/catalog/e2e-probe.txt").then((response) => response.text()));
  expect(catalog).toBe("catalog probe");

  const admin = await page.goto(hostUrl("example.com", "/admin"));
  expect(admin?.status()).toBeLessThan(400);
  expect(new URL(page.url()).pathname).toMatch(/^\/admin/);
});

test("the mock Cloudflare verifies the token and records the call", async ({ mock, urls }) => {
  const client = createCloudflareClient({ token: TEST_TOKEN, accountId: TEST_ACCOUNT_ID, baseUrl: urls.cloudflareApi });
  await expect(client.tokens.verify()).resolves.toMatchObject({ status: "active" });
  expect(mock.callsTo("tokens.verifyUser")).toHaveLength(1);

  mock.failNext({ route: "zones.list", status: 403 });
  await expect(client.zones.list()).rejects.toThrow();
});

test("the local D1 has the schema and starts every test empty", async ({ db }) => {
  expect(await db.sql("SELECT name FROM d1_migrations")).not.toHaveLength(0);
  expect(await db.sql("SELECT host FROM domains")).toEqual([]);
  await db.sql("INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)", "login:e2e", Date.now(), 1);
  expect(await db.sql("SELECT count FROM rate_limits WHERE key = ?", "login:e2e")).toEqual([{ count: 1 }]);
});

test("state from the previous test is gone", async ({ db, mock, urls }) => {
  expect(await db.sql("SELECT key FROM rate_limits")).toEqual([]);
  expect(mock.calls).toEqual([]);
  const stale = await fetch(`${urls.sites}/catalog/e2e-probe.txt`);
  expect(stale.status).toBe(404);
});

test("a logged-in owner sees the admin, on its own address and on a managed domain", async ({ login }) => {
  for (const host of [undefined, "example.com"]) {
    const page = await login(host);
    await expect(page.getByRole("heading", { name: "Deparked admin" })).toBeVisible();
  }
});

test("the host proxy refuses a Host header that is not <domain>.localhost", async ({ hostUrl }) => {
  const port = new URL(hostUrl("example.com")).port;
  const response = await fetch(`http://127.0.0.1:${port}/`);
  expect(response.status).toBe(400);
});
