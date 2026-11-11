import { afterEach, expect, it } from "vitest";
import { createCloudflareClient, hashAsset, verifyTurnstile } from "../index";
import { type MockCloudflareServer, startMockCloudflare, TURNSTILE_DUMMY_SECRET_PASS } from "./index";

let server: MockCloudflareServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

it("serves the same mock over HTTP: JSON calls, a multipart upload and siteverify", async () => {
  server = await startMockCloudflare({ token: "http-token", zones: [{ id: "zone-1", name: "example.com" }] });
  const client = createCloudflareClient({
    token: "http-token",
    accountId: server.mock.state.accountId,
    baseUrl: `${server.url}/client/v4`,
  });

  expect(await client.zones.list()).toMatchObject([{ name: "example.com" }]);
  const route = await client.zones.createRoute("zone-1", { pattern: "example.com/*", script: "deparked-test-sites" });
  expect(server.mock.state.routes.get("zone-1")).toEqual([route]);

  const content = new TextEncoder().encode("<h1>for sale</h1>");
  const manifest = { "/index.html": { hash: await hashAsset("/index.html", content), size: content.length } };
  const upload = await client.workers.uploadAssets({
    scriptName: "deparked-test-sites",
    manifest,
    read: async () => ({ content, contentType: "text/html" }),
  });
  await client.workers.uploadScript("deparked-test-sites", {
    compatibilityDate: "2026-11-01",
    assets: { jwt: upload.completionJwt },
  });
  const served = server.mock.deployedAssets("deparked-test-sites").get("/index.html");
  expect(new TextDecoder().decode(served?.body)).toBe("<h1>for sale</h1>");

  const verified = await verifyTurnstile({
    secret: TURNSTILE_DUMMY_SECRET_PASS,
    response: "token",
    url: `${server.url}/turnstile/v0/siteverify`,
  });
  expect(verified.success).toBe(true);

  server.mock.failNext({ route: "zones.get", status: 403 });
  await expect(client.zones.get("zone-1")).rejects.toThrow("read zone failed: 403");
});
