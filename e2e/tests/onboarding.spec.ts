import { expect, test } from "../fixtures";

// The first-run wizard on its own: the ways out and the ways it fails. The happy path is in full-flow.spec.ts.
const OWNER = "owner@example.com";

test("a failed send says so in plain words, and the next try works", async ({ login, mock, urls }) => {
  const page = await login();
  await page.goto(`${urls.admin}/admin/welcome`);
  await expect(page.getByRole("heading", { level: 1, name: "Where should offers land?" })).toBeVisible();

  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter the email address that should get the offers.");
  await page.getByLabel("Email address").fill("not an address");
  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(page.getByRole("alert")).toHaveText("That does not look like an email address. Check it for typos.");
  await expect(page.getByLabel("Email address")).toBeFocused();

  mock.failNext({ route: "email.createAddress", status: 503, message: "upstream down" });
  await page.getByLabel("Email address").fill(OWNER);
  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Cloudflare did not answer just now, so nothing was changed. Try again in a minute.",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Where should offers land?" })).toBeVisible();

  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your inbox" })).toBeVisible();
});

test("a rejected token points to Replace token", async ({ login, mock, urls }) => {
  const page = await login();
  await page.goto(`${urls.admin}/admin/welcome`);
  mock.failNext({ route: "email.createAddress", status: 401, code: 10000, message: "Authentication error" });
  await page.getByLabel("Email address").fill(OWNER);
  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(page.getByText("Cloudflare rejected the token")).toBeVisible();
  await expect(page.getByRole("link", { name: "Replace token in Settings" })).toHaveAttribute(
    "href",
    "/admin/settings/cloudflare",
  );
});

test("going on unverified, then skipping the domain, lands on the overview with the steps left", async ({
  login,
  mock,
  urls,
}) => {
  const page = await login();
  await page.goto(`${urls.admin}/admin/welcome`);
  await page.getByLabel("Email address").fill(OWNER);
  await page.getByRole("button", { name: "Send verification email" }).click();
  await page.getByRole("button", { name: "Next: add a domain" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Add your first domain" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Domains you can add" }).getByRole("listitem")).toHaveCount(2);
  // Reloading the domain step stays on it.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Add your first domain" })).toBeVisible();

  await page.getByRole("link", { name: "Skip for now" }).click();
  await page.waitForURL(`${urls.admin}/admin`);
  await expect(page.getByRole("heading", { name: "No domains yet" })).toBeVisible();

  // The steps left wait on the home screen, with their real state and nothing to tick by hand.
  const steps = page.getByRole("listitem").filter({ hasText: /to do|done/ });
  await expect(page.getByRole("heading", { name: "Finish setting up" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText("1 of 4 done", { exact: false })).toBeVisible();
  await expect(steps.filter({ hasText: "Add an address for offers" })).toContainText("(done)");
  await expect(steps.filter({ hasText: "Verify the address" })).toContainText(OWNER);
  mock.verifyAddress(OWNER);
  await steps.filter({ hasText: "Verify the address" }).getByRole("button", { name: "Check again" }).click();
  await expect(steps.filter({ hasText: "Verify the address" })).toContainText("(done)");
  await expect(page.getByText("2 of 4 done", { exact: false })).toBeVisible();

  // Hidden for good.
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(page.getByRole("heading", { name: "Finish setting up" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "No domains yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish setting up" })).toHaveCount(0);
});

test("when the address becomes verified it is announced and focus stays in the page", async ({ login, mock, urls }) => {
  const page = await login();
  await page.goto(`${urls.admin}/admin/welcome`);
  await page.getByLabel("Email address").fill(OWNER);
  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your inbox" })).toBeVisible();

  mock.verifyAddress(OWNER);
  await page.getByRole("button", { name: "I clicked the link" }).click();

  // The stepper in the header has its own live region; this one is the screen's.
  await expect(page.locator("main [aria-live=polite]")).toContainText("Your address is verified.");
  await expect(page.getByRole("button", { name: "Next: add a domain" })).toBeFocused();
});
