import { createCloudflareClient } from "@deparked/cf";
import { createDb, insertDomain, insertLedgerEntry, insertOffer } from "@deparked/db";
import { expect, TEST_ACCOUNT_ID, TEST_TOKEN, test } from "../fixtures";

const NEW_TOKEN = "e2e-dummy-replacement-token-0123456789";

/** The admin and the installer as an install leaves them in the mock Cloudflare. */
async function installedWorkers(urls: { cloudflareApi: string }, d1: D1Database) {
  const cf = createCloudflareClient({ token: TEST_TOKEN, accountId: TEST_ACCOUNT_ID, baseUrl: urls.cloudflareApi });
  for (const name of ["deparked-admin", "deparked-install"]) {
    await cf.workers.uploadScript(name, {
      mainModule: "index.js",
      modules: [{ name: "index.js", content: "export default {}" }],
      compatibilityDate: "2026-11-01",
    });
  }
  await insertLedgerEntry(createDb(d1), { resource: "worker", cfId: "deparked-admin", action: "created", now: 1 });
}

test("the owner sees the token's state, gets a banner when Cloudflare rejects it, and replaces it", async ({
  login,
  mock,
  urls,
  db,
}) => {
  await installedWorkers(urls, db.d1);
  const page = await login();
  await page.goto(`${urls.admin}/admin/settings/cloudflare`);
  await expect(page.getByText("Works", { exact: true })).toBeVisible();

  mock.denyPermission("turnstile");
  await page.reload();
  await expect(page.getByText("Missing permissions")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Turnstile" })).toBeVisible();
  mock.allowPermission("turnstile");

  // The owner deleted the token on Cloudflare: the next check says so, and every screen shows the banner.
  mock.state.token = NEW_TOKEN;
  await page.reload();
  await expect(page.getByText("Rejected by Cloudflare")).toBeVisible();
  await page.goto(`${urls.admin}/admin`);
  const banner = page.getByRole("alert").filter({ hasText: "Cloudflare rejects the saved API token." });
  await expect(banner).toBeVisible();
  await banner.getByRole("link", { name: "replace the token" }).click();

  await page.getByLabel("New API token").fill("too-short");
  await page.getByRole("button", { name: "Check and save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Paste the whole token" })).toBeVisible();
  expect(mock.callsTo("workers.putSecret")).toHaveLength(0);

  await page.getByLabel("New API token").fill(NEW_TOKEN);
  await page.getByRole("button", { name: "Check and save" }).click();
  await expect(page.getByText("The new token is saved.")).toContainText("within about a minute");
  const secret = mock.liveBindings("deparked-admin").find((binding) => binding.name === "CF_API_TOKEN");
  expect(secret).toMatchObject({ type: "secret_text", text: NEW_TOKEN });
  await expect(page.getByLabel("New API token")).toHaveValue("");
  // The local admin keeps the token it was started with (a deployed one restarts with the new secret): hand the
  // mock back to it, so the next check finds it working and the banner goes.
  mock.state.token = TEST_TOKEN;
  await page.reload();
  await expect(page.getByText("Works", { exact: true })).toBeVisible();
  await page.goto(`${urls.admin}/admin`);
  await expect(page.getByRole("heading", { name: "No domains yet" })).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test("uninstall counts what exists, needs a copy of the offers and the typed words, then deletes step by step", async ({
  login,
  mock,
  urls,
  db,
}) => {
  await installedWorkers(urls, db.d1);
  const data = createDb(db.d1);
  await insertDomain(data, { domain: { host: "example.com", zoneId: "zone-1" }, now: Date.now() });
  const buyer = { host: "example.com", currency: "USD", name: "Ada", email: "buyer@example.net", amountMinor: 100 };
  await insertOffer(data, { offer: buyer, now: Date.now() });
  const page = await login();
  await page.goto(`${urls.admin}/admin/settings/danger`);
  const card = page.getByRole("main");
  await expect(card).toContainText("This workspace has 1 domain and 1 offer.");
  await expect(card.getByRole("listitem").filter({ hasText: "The Worker deparked-install" })).toBeVisible();
  await expect(card.getByRole("heading", { name: "The database stays: delete it afterwards" })).toBeVisible();

  const confirm = page.getByLabel(/Type “uninstall deparked” to confirm/);
  const uninstall = page.getByRole("button", { name: "Uninstall Deparked" });
  await confirm.fill("uninstall deparked");
  await expect(uninstall).toHaveAttribute("aria-disabled", "true");
  await expect(card.getByText("Download your offers first, or tick that you need no copy.")).toBeVisible();
  // The tick alone would do; it is taken back to show the download counts too.
  await card.getByLabel("I don't need a copy of my offers").check();
  await expect(uninstall).not.toHaveAttribute("aria-disabled", "true");
  await card.getByLabel("I don't need a copy of my offers").uncheck();
  expect(mock.state.scripts.has("deparked-admin")).toBe(true);

  // The download is recorded on the server, so it still counts after a reload.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByRole("link", { name: "Download 1 offer (CSV)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^offers-.*\.csv$/);
  await expect(card.getByText("Download started")).toBeVisible();
  await page.reload();
  await expect(card.getByText(/^Downloaded/)).toBeVisible();

  await confirm.fill("uninstall");
  await uninstall.click();
  await expect(page.getByText("Type “uninstall deparked” to confirm.")).toBeVisible();
  expect(mock.state.scripts.has("deparked-admin")).toBe(true);

  await confirm.fill("Uninstall Deparked");
  await uninstall.click();
  await expect(page.getByText("Deparked is uninstalled.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Steps to uninstall Deparked" })).toContainText("Delete the admin panel");
  expect([...mock.state.scripts.keys()]).toEqual([]);
  expect(mock.callsTo("workers.deleteScript").at(-1)?.path).toContain("deparked-admin");
});
