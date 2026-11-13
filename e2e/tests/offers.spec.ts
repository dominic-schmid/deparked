import { createDb, insertDomain, insertOffer, setDomainStatus } from "@deparked/db";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const HOST = "example.com";
const buyer = { host: HOST, currency: "USD", email: "buyer@example.net" };

async function seedDomain(db: { d1: D1Database }) {
  const data = createDb(db.d1);
  const now = Date.now();
  await insertDomain(data, { domain: { host: HOST, zoneId: "zone-1" }, now });
  await setDomainStatus(data, { host: HOST, status: "live", now });
  return { data, now };
}

const list = (page: Page) => page.getByRole("region", { name: "List of offers" }).getByRole("listitem");
const detail = (page: Page) => page.getByRole("region", { name: "Selected offer" });

async function pick(page: Page, name: string, option: string) {
  await page.getByRole("combobox", { name }).click();
  await page.getByRole("option", { name: option }).click();
}

test("Offers sorts by highest offer from the URL, across pages and filters", async ({ login, db, urls }) => {
  const { data, now } = await seedDomain(db);
  // 27 offers: more than one page of 25. Amounts rise with age, so newest first is lowest first.
  for (let index = 0; index < 27; index++) {
    await insertOffer(data, {
      offer: { ...buyer, amountMinor: (27 - index) * 100_00, name: `Buyer ${index}` },
      now: now - 1000 + index,
    });
  }

  const page = await login();
  // The screen's old address still leads to it.
  await page.goto(`${urls.admin}/admin/inbox`);
  await expect(page).toHaveURL(/\/admin\/offers$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Offers");
  const offers = list(page);
  await expect(offers.first()).toContainText("Buyer 26");
  await expect(offers.first()).toContainText("$100");

  const sort = page.getByRole("combobox", { name: "Order" });
  await expect(sort).toContainText("Newest first");
  await pick(page, "Order", "Highest first");
  await expect(page).toHaveURL(/[?&]sort=highest/);
  await expect(offers.first()).toContainText("$2,700");
  await expect(offers).toHaveCount(25);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(offers).toHaveCount(27);
  await expect(offers.last()).toContainText("$100");
  await expect(page.getByText("That is all 27 offers.")).toBeVisible();

  await page.reload();
  await expect(sort).toContainText("Highest first");
  await expect(offers.first()).toContainText("$2,700");

  // A status filter keeps the order. New counts what waits.
  const show = page.getByRole("group", { name: "Show" });
  await show.getByRole("button", { name: /^New/ }).click();
  await expect(show.getByRole("button", { name: /^New/ })).toContainText("27");
  await expect(page).toHaveURL(/status=new/);
  await expect(page).toHaveURL(/sort=highest/);
  await expect(offers.first()).toContainText("$2,700");

  await pick(page, "Order", "Newest first");
  await expect(page).not.toHaveURL(/sort=/);
  await expect(offers.first()).toContainText("$100");

  // An old Inbox link with a filter keeps it.
  await page.goto(`${urls.admin}/admin/inbox?sort=highest`);
  await expect(page).toHaveURL(/\/admin\/offers\?sort=highest$/);
  await expect(offers.first()).toContainText("$2,700");

  // The domain's own offers page sorts the same way.
  await page.goto(`${urls.admin}/admin/d/${HOST}/offers?sort=highest`);
  await expect(page.getByRole("combobox", { name: "Order" })).toContainText("Highest first");
  await expect(offers.first()).toContainText("$2,700");
});

test("the selected offer lives in the URL and its actions change its status", async ({ login, db, urls }) => {
  const { data, now } = await seedDomain(db);
  await insertOffer(data, {
    offer: { ...buyer, amountMinor: 850_000, name: "Grace Hopper", country: "US" },
    now: now - 3000,
  });
  await insertOffer(data, {
    offer: { ...buyer, amountMinor: 250_000, name: "Ada Lovelace", country: "AT", message: "Can you do escrow?" },
    now: now - 1000,
  });

  const page = await login();
  await page.goto(`${urls.admin}/admin/offers`);
  // Without a choice, the first offer shows in full, with where it stands on its domain.
  await expect(detail(page).getByRole("heading", { level: 2 })).toContainText("Ada Lovelace offers$2,500");
  await expect(detail(page)).toContainText("Can you do escrow?");
  await expect(detail(page)).toContainText("Austria");
  await expect(detail(page)).toContainText("2nd of 2 offers on this domain, best is $8,500");
  await expect(detail(page).getByRole("link", { name: "Reply to Ada" })).toHaveAttribute(
    "href",
    /^mailto:buyer@example\.net\?/,
  );

  await list(page).filter({ hasText: "Grace Hopper" }).getByRole("link").click();
  await expect(page).toHaveURL(/[?&]offer=[0-9A-Z]{26}/);
  await expect(detail(page)).toContainText("1st of 2 offers on this domain, and the best");
  await page.reload();
  await expect(detail(page).getByRole("heading", { level: 2 })).toContainText("Grace Hopper offers$8,500");
  await page.goBack();
  await expect(detail(page).getByRole("heading", { level: 2 })).toContainText("Ada Lovelace");
  await page.goForward();

  const offersLink = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Offers/ });
  await expect(offersLink).toContainText("2");
  await detail(page).getByRole("button", { name: "I already replied" }).click();
  await expect(detail(page)).toContainText("Replied");
  await expect(offersLink).toContainText("1");
  expect(await db.sql("SELECT status FROM offers WHERE name = ?", "Grace Hopper")).toEqual([{ status: "replied" }]);
  // And back again.
  await detail(page).getByRole("button", { name: "Not replied yet" }).click();
  await expect(offersLink).toContainText("2");
  expect(await db.sql("SELECT status FROM offers WHERE name = ?", "Grace Hopper")).toEqual([{ status: "new" }]);
  await detail(page).getByRole("button", { name: "Not interested" }).click();
  await expect(detail(page)).toContainText("Not interested");
  expect(await db.sql("SELECT status FROM offers WHERE name = ?", "Grace Hopper")).toEqual([{ status: "ignored" }]);
});

test("on a phone the offer opens in a sheet that back closes", async ({ login, db, urls }) => {
  const { data, now } = await seedDomain(db);
  await insertOffer(data, { offer: { ...buyer, amountMinor: 250_000, name: "Ada Lovelace" }, now });
  const page = await login();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${urls.admin}/admin/offers`);
  await expect(list(page)).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await list(page).first().getByRole("link").click();
  const sheet = page.getByRole("dialog", { name: "Offer from Ada" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Reply to Ada" })).toBeVisible();
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await page.goForward();
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Close the offer" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).not.toHaveURL(/offer=/);
});

test("without JavaScript every offer reads and its status still changes", async ({ login, db, urls, browser }) => {
  const { data, now } = await seedDomain(db);
  await insertOffer(data, { offer: { ...buyer, amountMinor: 850_000, name: "Grace Hopper" }, now: now - 3000 });
  await insertOffer(data, { offer: { ...buyer, amountMinor: 250_000, name: "Ada Lovelace" }, now });
  const page = await login();
  const context = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const nojs = await context.newPage();
  await nojs.goto(`${urls.admin}/admin/offers`);
  // The filters are plain links: status, order and domain.
  const filters = nojs.getByRole("navigation", { name: "Filter offers" });
  await filters.getByRole("link", { name: "Highest first" }).click();
  await expect(nojs).toHaveURL(/\/admin\/offers\?sort=highest$/);
  await expect(list(nojs).first()).toContainText("Grace Hopper");
  await filters.getByText("Domain: All domains").click();
  await filters.getByRole("link", { name: HOST }).click();
  await expect(nojs).toHaveURL(/host=example\.com/);
  await filters.getByRole("link", { name: "Replied" }).click();
  await expect(nojs).toHaveURL(/status=replied/);
  await expect(nojs.getByRole("heading", { name: "No replied offers for example.com" })).toBeVisible();
  await filters.getByRole("link", { name: "All", exact: true }).click();
  await expect(nojs).not.toHaveURL(/status=/);
  await expect(list(nojs)).toHaveCount(2);
  await nojs.getByRole("link", { name: /Grace Hopper/ }).click();
  await expect(detail(nojs).getByRole("heading", { level: 2 })).toContainText("Grace Hopper offers$8,500");
  await expect(detail(nojs).getByRole("link", { name: "Reply to Grace" })).toHaveAttribute("href", /^mailto:/);

  await detail(nojs).getByRole("link", { name: "Not interested" }).click();
  await expect(nojs.getByRole("heading", { level: 1 })).toHaveText("Not interested in this offer?");
  await nojs.getByRole("button", { name: "Not interested" }).click();
  // Back where it came from, filters kept.
  await expect(nojs).toHaveURL(/\/admin\/offers\?host=example\.com&sort=highest&offer=[0-9A-Z]{26}$/);
  await expect(detail(nojs)).toContainText("Not interested");
  expect(await db.sql("SELECT status FROM offers WHERE name = ?", "Grace Hopper")).toEqual([{ status: "ignored" }]);
  await context.close();

  // The form posts like every other: from this origin only.
  const forged = await page.request.post(`${urls.admin}/admin/offer-status`, {
    form: { id: "01ABC", status: "new", back: "/admin/offers" },
    headers: { Origin: "https://evil.example" },
    maxRedirects: 0,
  });
  expect(forged.status()).toBe(403);
});

test("empty states say what brings offers, or how to see more", async ({ login, db, urls }) => {
  const { data, now } = await seedDomain(db);
  const page = await login();
  await page.goto(`${urls.admin}/admin/offers`);
  await expect(page.getByRole("heading", { name: "No offers yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: `See ${HOST} as visitors do` })).toHaveAttribute(
    "href",
    `https://${HOST}/`,
  );

  await insertOffer(data, { offer: { ...buyer, amountMinor: 250_000, name: "Ada Lovelace" }, now });
  await page.goto(`${urls.admin}/admin/offers?status=ignored`);
  await expect(page.getByRole("heading", { name: "No ignored offers" })).toBeVisible();
  await page.getByRole("link", { name: "Show all offers" }).click();
  await expect(list(page)).toHaveCount(1);
});

test("hostile buyer input shows as plain text in Offers and runs nothing", async ({ login, db, urls }) => {
  const { data, now } = await seedDomain(db);
  const name = `"><script>window.__pwned = 1</script>`;
  const message = `<img src=x onerror="window.__pwned = 2"> =cmd|' /C calc'!A0`;
  await insertOffer(data, { offer: { ...buyer, amountMinor: 500_00, name, message }, now });

  const page = await login();
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto(`${urls.admin}/admin/offers`);
  const row = list(page).first();
  await expect(row).toContainText(name);
  await expect(row.locator("script, img")).toHaveCount(0);
  await expect(detail(page)).toContainText(name);
  await expect(detail(page)).toContainText(message);
  await expect(detail(page).locator("script, img")).toHaveCount(0);
  await expect(detail(page).getByRole("link", { name: /^Reply to/ })).toHaveAttribute(
    "href",
    /^mailto:buyer@example\.net\?/,
  );

  // The phone's sheet too.
  await page.setViewportSize({ width: 390, height: 844 });
  await row.getByRole("link").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText(message);
  await expect(sheet.locator("script, img")).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(dialogs).toEqual([]);
});
