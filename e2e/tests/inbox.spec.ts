import { createDb, insertDomain, insertOffer, setDomainStatus } from "@deparked/db";
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

test("the inbox sorts by highest offer from the URL, across pages and filters", async ({ login, db, urls }) => {
  const { data, now } = await seedDomain(db);
  // 27 offers: more than one page of 25. Amounts rise with age, so newest first is lowest first.
  for (let index = 0; index < 27; index++) {
    await insertOffer(data, {
      offer: { ...buyer, amountMinor: (27 - index) * 100_00, name: `Buyer ${index}` },
      now: now - 1000 + index,
    });
  }

  const page = await login();
  await page.goto(`${urls.admin}/admin/inbox`);
  const offers = page.getByRole("main").getByRole("listitem");
  await expect(offers.first()).toContainText("Buyer 26");
  await expect(offers.first()).toContainText("$100.00");

  const sort = page.getByLabel("Sort");
  await expect(sort).toHaveValue("newest");
  await sort.focus();
  await sort.selectOption("highest");
  await expect(page).toHaveURL(/[?&]sort=highest/);
  await expect(page.getByText("Offers from every domain, highest first.")).toBeVisible();
  await expect(offers.first()).toContainText("$2,700.00");
  await expect(offers).toHaveCount(25);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(offers).toHaveCount(27);
  await expect(offers.last()).toContainText("$100.00");
  await expect(page.getByText("That is all 27 offers.")).toBeVisible();

  await page.reload();
  await expect(sort).toHaveValue("highest");
  await expect(offers.first()).toContainText("$2,700.00");

  // A status filter keeps the order.
  await page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: "New" }).click();
  await expect(page).toHaveURL(/status=new/);
  await expect(page).toHaveURL(/sort=highest/);
  await expect(offers.first()).toContainText("$2,700.00");

  await sort.selectOption("newest");
  await expect(page).not.toHaveURL(/sort=/);
  await expect(offers.first()).toContainText("$100.00");

  // The domain's own offers page sorts the same way.
  await page.goto(`${urls.admin}/admin/d/${HOST}/offers?sort=highest`);
  await expect(page.getByLabel("Sort")).toHaveValue("highest");
  await expect(offers.first()).toContainText("$2,700.00");
});

test("hostile buyer input shows as plain text in the inbox and runs nothing", async ({ login, db, urls }) => {
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
  await page.goto(`${urls.admin}/admin/inbox`);
  const card = page.getByRole("main").getByRole("listitem").first();
  await expect(card).toContainText(name);
  await expect(card).toContainText(message);
  await expect(card.locator("script, img")).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(dialogs).toEqual([]);
  await expect(card.getByRole("link", { name: "Reply by email" })).toHaveAttribute(
    "href",
    /^mailto:buyer@example\.net\?/,
  );
});
