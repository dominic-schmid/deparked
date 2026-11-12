import type { Page } from "@playwright/test";
import { expect, TEST_RELEASE, TEST_TOKEN, test } from "../fixtures";

async function connect(page: Page, installUrl: string, token = TEST_TOKEN) {
  await page.goto(installUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Connect your Cloudflare account" })).toBeVisible();
  await page.getByLabel("API token").fill(token);
  await page.getByRole("button", { name: "Check the token" }).click();
}

test("installs from a real release through to the admin's setup link", async ({ page, urls, mock, db }) => {
  await connect(page, urls.install);
  await expect(
    page.getByRole("heading", { level: 1, name: `Ready to install Deparked ${TEST_RELEASE}` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Install Deparked" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Deparked is installed" })).toBeVisible({ timeout: 20_000 });
  const setupUrl = await page.getByRole("link", { name: "Create your password" }).getAttribute("href");
  expect(setupUrl).toMatch(/^https:\/\/deparked-admin\.mock\.workers\.dev\/admin\/setup\?secret=[0-9a-f]{64}$/);

  // What was installed, in the mock Cloudflare: both Workers, the catalog, the token only as a secret.
  expect([...mock.state.scripts.keys()].sort()).toEqual(["deparked-admin", "deparked-sites"]);
  expect([...mock.deployedAssets("deparked-sites").keys()]).toContain("/catalog/catalog.json");
  const token = mock.liveBindings("deparked-admin").find((binding) => binding.name === "CF_API_TOKEN");
  expect(token).toMatchObject({ type: "secret_text" });
  expect(await db.sql("SELECT installed_release FROM workspace")).toEqual([{ installed_release: TEST_RELEASE }]);
  expect(JSON.stringify(await db.sql("SELECT * FROM install_state"))).not.toContain(TEST_TOKEN);

  // The local admin shares the database: the link's secret creates the password there.
  const local = new URL(setupUrl ?? "");
  await page.goto(`${urls.admin}${local.pathname}${local.search}`);
  await page.getByLabel("Password", { exact: true }).fill("a-long-new-password");
  await page.getByLabel("Repeat password").fill("a-long-new-password");
  await page.getByRole("button", { name: "Create password" }).click();
  await page.waitForURL(`${urls.admin}/admin`);

  // Afterwards the installer says so, and offers a new link instead of a second install.
  await page.goto(urls.install);
  await expect(page.getByRole("heading", { level: 1, name: "Deparked is installed" })).toBeVisible();
  await page.getByLabel("API token").fill(TEST_TOKEN);
  await page.getByRole("button", { name: "Get a new setup link" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Here is a new setup link" })).toBeVisible();
});

test("a wrong token gets a plain answer", async ({ page, urls }) => {
  await connect(page, urls.install, "not-the-right-token-at-all-0000");
  await expect(page.getByRole("alert")).toContainText("Cloudflare does not accept this token");
});

test("a missing permission is named before anything changes", async ({ page, urls, mock }) => {
  mock.denyPermission("turnstile");
  await connect(page, urls.install);
  await expect(page.getByRole("heading", { level: 1, name: "The token is missing permissions" })).toBeVisible();
  await expect(page.getByText("Turnstile", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Install Deparked" })).toHaveCount(0);
  expect(mock.state.scripts.size).toBe(0);
});

test("a token of another account cannot claim the installer", async ({ page, urls, mock }) => {
  mock.state.databases = [];
  await connect(page, urls.install);
  await expect(page.getByRole("alert")).toContainText("for another Cloudflare account");
  expect(mock.state.scripts.size).toBe(0);
});

test("a failed step shows Retry and continues where it stopped", async ({ page, urls, mock }) => {
  mock.failNext({ route: "workers.uploadScript", nth: 2, status: 500, times: 3 });
  await connect(page, urls.install);
  await page.getByRole("button", { name: "Install Deparked" }).click();
  const retry = page.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("alert")).toContainText("upload Worker deparked-admin failed");
  await retry.click();
  await expect(page.getByRole("heading", { level: 1, name: "Deparked is installed" })).toBeVisible({ timeout: 20_000 });
  expect(mock.callsTo("workers.uploadScript").length).toBe(5);
});

test("closing the tab half way resumes from the database", async ({ page, urls, mock }) => {
  mock.failNext({ route: "workers.uploadScript", nth: 2, status: 500, times: 3 });
  await connect(page, urls.install);
  await page.getByRole("button", { name: "Install Deparked" }).click();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(page.getByText("An install is half done")).toBeVisible();
  await page.getByLabel("API token").fill(TEST_TOKEN);
  await page.getByRole("button", { name: "Check and continue" }).click();
  await expect(page.getByText("already done").first()).toBeVisible();
  await page.getByRole("button", { name: "Install Deparked" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Deparked is installed" })).toBeVisible({ timeout: 20_000 });
  expect([...mock.state.scripts.keys()].sort()).toEqual(["deparked-admin", "deparked-sites"]);
});
