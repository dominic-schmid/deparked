import { expect, TEST_RELEASE, TEST_TOKEN, test } from "../fixtures";

// The v1 acceptance flow, one piece handing over to the next with nothing seeded in between: install, password,
// the first-run wizard (notify address, first domain), edit and publish, a visitor's offer, the inbox and the mail.
const HOST = "example.com";
const OWNER = "owner@example.com";
const PASSWORD = "a-long-new-password";
const HEADLINE = "{domain} is looking for its next owner";
const SHOWN = "example.com is looking for its next owner";
const TURNSTILE_TOKEN = "e2e-turnstile-token";

// Stands in for Turnstile's script, which CI cannot load: renders nothing and passes a moment after `execute`.
const TURNSTILE_STUB = `window.turnstile = {
  render(box, options) { this.options = options; return "widget"; },
  execute() { setTimeout(() => this.options.callback(${JSON.stringify(TURNSTILE_TOKEN)}), 20); },
  reset() {},
};`;

test("install, set up, add a domain, publish it, take an offer and read it in the inbox", async ({
  page,
  context,
  urls,
  mock,
  db,
  hostUrl,
  writeSiteFile,
  sentMail,
}) => {
  test.setTimeout(180_000);

  await test.step("install through the installer", async () => {
    await page.goto(urls.install);
    await page.getByLabel("API token").fill(TEST_TOKEN);
    await page.getByRole("button", { name: "Check the token" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Ready to install Deparked ${TEST_RELEASE}` }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Install Deparked" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Deparked is installed" })).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step("open the setup link and create the password", async () => {
    const link = new URL((await page.getByRole("link", { name: "Create your password" }).getAttribute("href")) ?? "");
    // The link names the admin's workers.dev address; the local admin is the same Worker on the same database.
    await page.goto(`${urls.admin}${link.pathname}${link.search}`);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Repeat password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create password" }).click();
    await page.waitForURL(`${urls.admin}/admin/welcome`);
  });

  await test.step("the wizard: where offers go, verified while it waits", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Where should offers go?" })).toBeVisible();
    await page.getByLabel("Email address").fill(OWNER);
    await page.getByRole("button", { name: "Send verification email" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Check your inbox" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: OWNER })).toContainText("Pending");
    // A reload resumes the wizard where it was.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Check your inbox" })).toBeVisible();
    mock.verifyAddress(OWNER);
    await page.getByRole("button", { name: "I clicked the link" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Offers will reach you" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: OWNER })).toContainText("Verified");
    await page.getByRole("button", { name: "Next: add a domain" }).click();
  });

  await test.step("the wizard: add the first domain from the Cloudflare account", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Add your first domain" })).toBeVisible();
    await page
      .getByRole("list", { name: "Domains you can add" })
      .getByRole("button", { name: /example\.com/ })
      .click();
    await page.getByRole("button", { name: `Add ${HOST}` }).click();
    await expect(page.getByRole("heading", { name: `${HOST} is set up` })).toBeVisible({ timeout: 30_000 });
    // With a domain the wizard is over.
    await page.goto(`${urls.admin}/admin/welcome`);
    await page.waitForURL(`${urls.admin}/admin`);
    await expect(page.getByRole("heading", { name: "All domains" })).toBeVisible();
  });

  await test.step("send the domain's offers to the verified address", async () => {
    await page.goto(`${urls.admin}/admin/d/${HOST}/settings`);
    // A click before the page hydrates opens nothing: click until the list is open.
    const option = page.getByRole("option", { name: OWNER });
    await expect(async () => {
      if (!(await option.isVisible())) await page.getByLabel("Send offers to").click();
      await expect(option).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await option.click();
    await expect(page.getByText(`Offers for ${HOST} go to ${OWNER}.`)).toBeVisible();
  });

  await test.step("edit the headline, pick another design and publish", async () => {
    await page.goto(`${urls.admin}/admin/d/${HOST}`);
    const preview = page.frameLocator(`iframe[title="Preview of ${HOST}"]`);
    await page.getByLabel("Headline").fill(HEADLINE);
    await page.getByRole("radiogroup", { name: "Design" }).getByRole("radio", { name: "Gradient" }).click();
    await expect(preview.getByRole("heading", { level: 1 })).toHaveText(SHOWN);
    await expect(page.getByText("Draft saved")).toBeVisible();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Published", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("The draft matches the live page.")).toBeVisible();
  });

  await test.step("a visitor sends an offer through the page's form", async () => {
    // What the mock Cloudflare now serves for the domain goes into the local pages Worker.
    for (const [path, file] of mock.deployedAssets("deparked-sites")) {
      if (path.startsWith(`/sites/${HOST}/`)) await writeSiteFile(path.slice(1), file.body);
    }
    const [live] = await db.sql<{ live_json: string }>("SELECT live_json FROM config WHERE host = ?", HOST);
    expect(JSON.parse(live?.live_json ?? "{}")).toMatchObject({ variant: "gradient", headline: HEADLINE });

    const visitor = await context.newPage();
    await visitor.route("https://challenges.cloudflare.com/**", (route) =>
      route.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB }),
    );
    mock.state.siteverify = { success: true, hostname: HOST };
    await visitor.goto(hostUrl(HOST));
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(SHOWN);
    await visitor.locator('input[name="amount"]').fill("12500");
    await visitor.locator('input[name="name"]').fill("Ada Example");
    await visitor.locator('input[name="email"]').fill("ada@example.net");
    await visitor.locator('button[type="submit"]').click();
    await expect(visitor.getByRole("heading", { level: 2 })).toHaveText(
      "Thanks, Ada Example. Your €12,500 offer is with the owner.",
    );
    await visitor.close();
    expect(mock.callsTo("turnstile.siteverify")).toHaveLength(1);
  });

  await test.step("the offer is in the inbox and the owner got the mail", async () => {
    await page.goto(`${urls.admin}/admin/inbox`);
    const offers = page.getByRole("main").getByRole("listitem");
    await expect(offers).toHaveCount(1);
    await expect(offers.first()).toContainText("Ada Example");
    await expect(offers.first()).toContainText("12,500");
    expect(await db.sql("SELECT email_status, notified_to FROM offers")).toEqual([
      { email_status: "sent", notified_to: OWNER },
    ]);
    await expect.poll(() => sentMail().length).toBe(1);
    const [mail] = sentMail();
    expect(mail).toContain(`To: ${OWNER}`);
    expect(mail).toContain(`offers@${HOST}`);
    expect(mail).toContain("Ada Example");
  });
});
