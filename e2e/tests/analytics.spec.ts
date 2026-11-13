import { createDb, insertDomain, insertOffer, setDomainStatus } from "@deparked/db";
import { expect, test } from "../fixtures";

const DAY = 86_400_000;
const day = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);

// The admin keeps a report for five minutes per set of sites, so each test uses site tags of its own.
test("visits, conversion, referrers and countries come from Web Analytics next to the offers", async ({
  login,
  db,
  mock,
}) => {
  const data = createDb(db.d1);
  const now = Date.now();
  await insertDomain(data, {
    domain: { host: "example.com", zoneId: "zone-1", analyticsSiteTag: "e2e-visits" },
    now,
  });
  await setDomainStatus(data, { host: "example.com", status: "live", now });
  await insertDomain(data, { domain: { host: "example.org", zoneId: "zone-2" }, now });
  await insertOffer(data, {
    offer: { host: "example.com", amountMinor: 150_000, currency: "USD", name: "Ada", email: "buyer@example.net" },
    now,
  });
  const visit = { siteTag: "e2e-visits", host: "example.com", referrer: "", country: "Germany" };
  mock.state.analytics.push(
    { ...visit, date: day(0), visits: 5, referrer: "news.example", country: "Austria" },
    { ...visit, date: day(3), visits: 2 },
    { ...visit, date: day(10), visits: 3 },
    { ...visit, date: day(40), visits: 500 },
  );

  const page = await login();
  const card = (host: string) => page.getByRole("article").filter({ hasText: host });
  await expect(card("example.com")).toContainText("10 visits in 30 days");
  await expect(card("example.org").getByRole("link", { name: "Set up visits" })).toHaveAttribute(
    "href",
    "/admin/add?host=example.org",
  );
  await page.getByRole("radio", { name: "List" }).click();
  const row = (host: string) => page.getByRole("row").filter({ hasText: host });
  await expect(row("example.com")).toContainText("7 / 10");
  await expect(row("example.com")).toContainText("10%");
  await expect(row("example.org")).toContainText("Not set up");
  expect(mock.callsTo("analytics.graphql")).toHaveLength(1);

  await row("example.com").getByRole("link", { name: "example.com" }).click();
  await page.getByRole("navigation", { name: "Domain" }).getByRole("link", { name: "Analytics" }).click();
  await expect(page).toHaveURL(/\/admin\/d\/example\.com\/analytics$/);
  const main = page.getByRole("main");
  const stat = (label: string) => main.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd");
  await expect(stat("Visits, 7 days")).toHaveText("7");
  await expect(stat("Visits, 30 days")).toHaveText("10");
  await expect(stat("Offers, 30 days")).toHaveText("1");
  await expect(stat("Conversion, 30 days")).toHaveText("10%");

  const referrers = main.getByRole("listitem").filter({ has: page.getByText(/^(Direct|news\.example)$/) });
  await expect(referrers).toHaveText([/news\.example\s*5/, /Direct\s*5/]);
  await expect(main.getByRole("listitem").filter({ hasText: "Austria" })).toContainText("5");

  await main.getByText("Visits per day as a table").click();
  const today = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(now);
  await expect(main.getByRole("row", { name: new RegExp(`^${today} 5$`) })).toBeVisible();
});

test("a rejected token leaves the page readable, says what to fix, and is not remembered", async ({
  login,
  db,
  mock,
}) => {
  const data = createDb(db.d1);
  const now = Date.now();
  await insertDomain(data, {
    domain: { host: "example.com", zoneId: "zone-1", analyticsSiteTag: "e2e-rejected" },
    now,
  });
  await insertDomain(data, { domain: { host: "example.org", zoneId: "zone-2", status: "live" }, now });
  mock.failNext({ route: "analytics.graphql", status: 403, code: 10000, message: "Authentication error" });

  const page = await login();
  await expect(page.getByRole("heading", { name: "All domains" })).toBeVisible();
  await expect(page.getByText("Visits are not available right now")).toBeVisible();
  await expect(page.getByText(/Cloudflare rejected the saved API token/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Check the Cloudflare token" })).toHaveAttribute(
    "href",
    "/admin/settings/cloudflare",
  );
  await expect(page.getByRole("article").filter({ hasText: "example.com" })).toContainText("Visits unavailable");
  // A domain without a site is not set up, whether or not the read worked, and says how to fix it.
  await expect(
    page.getByRole("article").filter({ hasText: "example.org" }).getByRole("link", { name: "Set up visits" }),
  ).toHaveAttribute("href", "/admin/add?host=example.org");
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.getByRole("row").filter({ hasText: "example.com" })).toContainText("Unavailable");
  const bare = page.getByRole("row").filter({ hasText: "example.org" });
  await expect(bare).toContainText("Not set up");
  await expect(bare.getByRole("link", { name: "Set it up" })).toHaveAttribute("href", "/admin/add?host=example.org");

  mock.failNext({ route: "analytics.graphql", status: 503, times: 3 });
  await page.getByRole("row").filter({ hasText: "example.com" }).getByRole("link", { name: "example.com" }).click();
  await page.getByRole("navigation", { name: "Domain" }).getByRole("link", { name: "Analytics" }).click();
  await expect(page.getByText("Cloudflare did not answer in time")).toBeVisible();
  await expect(page.getByText("Offers, 30 days")).toBeVisible();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Cloudflare did not answer in time")).toHaveCount(0);
  await expect(page.getByText("No visits in the last 30 days")).toBeVisible();
});

test("more offers than counted visits reads >100%, with the reason a click away", async ({ login, db, mock }) => {
  const data = createDb(db.d1);
  const now = Date.now();
  await insertDomain(data, { domain: { host: "example.com", zoneId: "zone-1", analyticsSiteTag: "e2e-over" }, now });
  await setDomainStatus(data, { host: "example.com", status: "live", now });
  const offer = { host: "example.com", amountMinor: 100, currency: "USD", name: "Ada", email: "buyer@example.net" };
  await insertOffer(data, { offer, now });
  await insertOffer(data, { offer, now: now + 1 });
  mock.state.analytics.push({
    siteTag: "e2e-over",
    host: "example.com",
    referrer: "",
    country: "Germany",
    date: day(0),
    visits: 1,
  });

  const page = await login();
  await page.getByRole("radio", { name: "List" }).click();
  const row = page.getByRole("row").filter({ hasText: "example.com" });
  await row.getByRole("button", { name: /^>100%.*why/ }).click();
  await expect(page.getByRole("dialog")).toContainText("does not count visitors who block its script");
});
