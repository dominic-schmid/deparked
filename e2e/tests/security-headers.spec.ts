import { createDb, insertDomain, setDomainStatus } from "@deparked/db";
import type { APIResponse } from "@playwright/test";
import { expect, test, ZONES } from "../fixtures";

const HOST = "example.com";

function expectNoFraming(response: APIResponse) {
  const headers = response.headers();
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
}

test("every admin page, redirect and API answer carries the CSP that forbids framing", async ({
  request,
  urls,
  login,
}) => {
  const anonymous = await request.get(`${urls.admin}/admin`, { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  expectNoFraming(anonymous);

  // Login is only served once a password exists; `request` has no session of its own.
  await login();
  const loginPage = await request.get(`${urls.admin}/admin/login`);
  expect(loginPage.status()).toBe(200);
  expect(loginPage.headers()["content-type"]).toContain("text/html");
  expectNoFraming(loginPage);
  expect(loginPage.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+'/);

  const health = await request.get(`${urls.admin}/api/health`);
  expect(health.status()).toBe(401);
  expectNoFraming(health);

  const offer = await request.post(`${urls.admin}/api/offer`, { data: {} });
  expect(offer.status()).toBeGreaterThanOrEqual(400);
  expectNoFraming(offer);
});

test("a logged-in page carries the CSP, and the editor's preview is a sandboxed frame without scripts", async ({
  login,
  db,
  urls,
}) => {
  const data = createDb(db.d1);
  const now = Date.now();
  await insertDomain(data, { domain: { host: HOST, zoneId: ZONES[0]?.id ?? "" }, now });
  await setDomainStatus(data, { host: HOST, status: "live", now });

  const page = await login();
  const editor = await page.goto(`${urls.admin}/admin/d/${HOST}`);
  const csp = (await editor?.allHeaders())?.["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("frame-src 'self'");

  const preview = page.locator(`iframe[title="Preview of ${HOST}"]`);
  await expect(page.frameLocator(`iframe[title="Preview of ${HOST}"]`).getByRole("heading", { level: 1 })).toHaveText(
    HOST,
  );
  // An empty sandbox: no scripts, no same-origin access to the admin, no forms, no popups, no top navigation.
  expect(await preview.getAttribute("sandbox")).toBe("");
  // A unique origin: the admin's page cannot reach into the preview, so the preview cannot reach the admin either.
  expect(await preview.evaluate((element) => (element as HTMLIFrameElement).contentDocument)).toBeNull();
});

test("another site cannot frame the admin", async ({ page, urls, writeSiteFile }) => {
  await writeSiteFile(
    "framer.html",
    `<!doctype html><title>framer</title><iframe id="admin" src="${urls.admin}/admin/login"></iframe>`,
  );
  const blocked = page.waitForEvent("console", (message) => message.text().includes("frame-ancestors"));
  await page.goto(`${urls.sites}/framer.html`);
  await blocked;
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  await expect.poll(() => frame?.url()).toMatch(/^chrome-error:/);
});
