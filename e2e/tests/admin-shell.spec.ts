import { readFile } from "node:fs/promises";
import { createDb, insertDomain, insertNotifyAddress, insertOffer, setDomainStatus } from "@deparked/db";
import { expect, test } from "../fixtures";

const OWNER = "owner@example.com";

test("the owner goes from an empty workspace to a handled offer, an export and a new notify address", async ({
  login,
  db,
  mock,
  request,
  urls,
}) => {
  const page = await login();
  await expect(page.getByRole("heading", { name: "No domains yet" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Add a domain" })).toBeVisible();

  const data = createDb(db.d1);
  const now = Date.now();
  await insertNotifyAddress(data, { email: OWNER, verifiedAt: now, now });
  await insertDomain(data, { domain: { host: "example.com", zoneId: "zone-1", notifyEmail: OWNER }, now });
  await insertDomain(data, { domain: { host: "example.org", zoneId: "zone-2" }, now });
  await setDomainStatus(data, { host: "example.com", status: "live", now });
  const buyer = { currency: "USD", email: "buyer@example.net" };
  await insertOffer(data, {
    offer: { ...buyer, host: "example.com", amountMinor: 150_000, name: "Ada" },
    now: now - 3,
  });
  await insertOffer(data, {
    offer: { ...buyer, host: "example.com", amountMinor: 990_000, name: "=SUM(A1)" },
    now: now - 2,
  });
  await insertOffer(data, { offer: { ...buyer, host: "example.org", amountMinor: 500, name: "Grace" }, now: now - 1 });

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Three offers are waiting for you.");
  await expect(page.getByRole("heading", { name: "All domains" })).toBeVisible();
  // Each domain is a window: its state or next step, and its offers as a price tag.
  const card = (host: string) =>
    page
      .getByRole("region", { name: /^All domains/ })
      .getByRole("article")
      .filter({ hasText: host });
  await expect(card("example.com")).toContainText("Live");
  await expect(card("example.com").getByRole("link", { name: /^2 offers · \$9,900\s*, 2 new$/ })).toBeVisible();
  await expect(card("example.org").getByRole("link", { name: "Finish its page" })).toHaveAttribute(
    "href",
    "/admin/d/example.org",
  );
  // The list view says the same in a row per domain, and the choice is remembered.
  await page.getByRole("radio", { name: "List" }).click();
  const row = (host: string) => page.getByRole("row").filter({ hasText: host });
  await expect(row("example.com")).toContainText("Live");
  await expect(row("example.com")).toContainText("2 (2 new)");
  await expect(row("example.com")).toContainText("$9,900");
  await expect(row("example.org")).toContainText("Draft");
  await page.reload();
  await expect(row("example.com")).toContainText("2 (2 new)");

  const offersLink = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Offers/ });
  await expect(offersLink).toContainText("3");
  await offersLink.click();
  const offers = page.getByRole("region", { name: "List of offers" }).getByRole("listitem");
  await expect(offers).toHaveCount(3);
  await expect(offers.first()).toContainText("Grace");
  // The newest offer shows in full beside the list.
  const selected = page.getByRole("region", { name: "Selected offer" });
  await expect(selected).toContainText("Grace offers");
  await selected.getByRole("button", { name: "I already replied" }).click();
  await expect(selected).toContainText("Replied");
  await expect(offersLink).toContainText("2");
  expect(await db.sql("SELECT status FROM offers WHERE name = ?", "Grace")).toEqual([{ status: "replied" }]);

  const anonymous = await request.get(`${urls.admin}/admin/offers.csv`, { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  expect(anonymous.headers().location).toBe("/admin/login");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download as a spreadsheet" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^offers-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile(await download.path(), "utf8");
  expect(csv.trimEnd().split("\r\n")).toHaveLength(4);
  expect(csv).toContain("example.org,5.00,USD,Grace,buyer@example.net,,,replied");
  expect(csv).toContain("example.com,9900.00,USD,'=SUM(A1),buyer@example.net");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Add another address").fill("Second@Example.org");
  await page.getByRole("button", { name: "Add address" }).click();
  await expect(page.getByText("Verification email sent to second@example.org")).toBeVisible();
  const added = page.getByRole("listitem").filter({ hasText: "second@example.org" });
  await expect(added).toContainText("Waiting for you to click the link in its inbox");
  await expect(added.getByRole("button", { name: "I clicked it" })).toBeVisible();
  // Right after the first mail the limit answers in that row, in plain words.
  await added.getByRole("button", { name: "Send it again" }).click();
  await expect(added.getByRole("alert")).toContainText("You can send another in a minute.");
  expect(mock.callsTo("email.createAddress")).toHaveLength(1);
  expect(mock.state.addresses.map((address) => address.email)).toEqual(["second@example.org"]);
});
