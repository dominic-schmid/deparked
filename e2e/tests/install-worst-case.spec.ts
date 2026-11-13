import type { MockPermission } from "@deparked/cf/mock";
import type { Page } from "@playwright/test";
import { expect, TEST_TOKEN, test } from "../fixtures";

// Worst-case data (break-ui): every permission missing, 40 accounts with long names, a long Cloudflare error.
async function fitsWidth(page: Page, width: number) {
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(width);
}

const ALL: MockPermission[] = [
  "workers",
  "d1",
  "turnstile",
  "analytics",
  "email_addresses",
  "zones",
  "routes",
  "dns",
  "rulesets",
  "email_routing",
];

for (const width of [320, 1280])
  test(`worst cases ${width}`, async ({ page, urls, mock }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 800 });
    // Every permission missing.
    for (const permission of ALL) mock.denyPermission(permission);
    await page.goto(urls.install);
    await page.getByLabel("API token").fill(TEST_TOKEN);
    await page.getByRole("button", { name: "Check the token" }).click();
    await expect(page.getByRole("heading", { name: "The token is missing permissions" })).toBeVisible();
    await fitsWidth(page, width);
    for (const permission of ALL) mock.allowPermission(permission);

    // 40 accounts, long names.
    mock.state.accountName =
      "Aleksandra Wiśniewska-Kowalczyk's Northwind Industries Holdings Domain Portfolio (Europe)";
    mock.state.otherAccounts = Array.from({ length: 39 }, (_, index) => ({
      id: `0123456789abcdef0123456789abcd${String(index).padStart(2, "0")}`,
      name: index % 3 === 0 ? `Jo` : `Bartholomew Fitzgerald-Montgomery III, Northwind Industries Holdings ${index}`,
    }));
    await page.goto(urls.install);
    await page.getByLabel("API token").fill(TEST_TOKEN);
    await page.getByRole("button", { name: "Check the token" }).click();
    await expect(page.getByRole("heading", { name: "Which account is this?" })).toBeVisible();
    await fitsWidth(page, width);
    // Arc's radio rows hide the native input under the row: the owner presses the row.
    await page
      .locator("label")
      .filter({ has: page.getByRole("radio") })
      .first()
      .click();
    await page.getByRole("button", { name: "Use this account" }).click();
    await expect(page.getByRole("button", { name: "Install Deparked" })).toBeVisible();
    await fitsWidth(page, width);
    // A long error from Cloudflare.
    mock.failNext({
      route: "workers.uploadScript",
      nth: 1,
      status: 400,
      code: 10021,
      message:
        'Uncaught Error: No such module "admin/_assets/server.edge-Cs_JSgQ3.js". imported from "index.js" at https://deparked-admin.northwind-industries-holdings-domain-portfolio.workers.dev/admin/_assets/really/long/path/that/never/ends/and/keeps/going.js',
    });
    await page.getByRole("button", { name: "Install Deparked" }).click();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 20_000 });
    await fitsWidth(page, width);
  });
