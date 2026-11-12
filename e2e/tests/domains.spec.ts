import { createCloudflareClient } from "@deparked/cf";
import { createDb, insertDomain, insertLedgerEntry, replaceSiteFiles } from "@deparked/db";
import { expect, TEST_ACCOUNT_ID, TEST_TOKEN, test, ZONES } from "../fixtures";

const HOST = "example.com";
const ZONE_ID = ZONES[0]?.id ?? "";
const FONT = "/catalog/fonts/e2e.woff2";
const FONT_HASH = "0123456789abcdef0123456789abcdef";

test("the owner adds a domain from the Cloudflare account, sees its placeholder live, then turns it off", async ({
  login,
  db,
  mock,
  urls,
  hostUrl,
  writeSiteFile,
}) => {
  test.setTimeout(120_000);
  // What an install has before any domain: the admin Worker (bot-check secrets go on it) and the shared catalog,
  // already uploaded to the pages Worker.
  await createCloudflareClient({
    token: TEST_TOKEN,
    accountId: TEST_ACCOUNT_ID,
    baseUrl: urls.cloudflareApi,
  }).workers.uploadScript("deparked-admin", {
    mainModule: "index.js",
    modules: [{ name: "index.js", content: "export default {}" }],
    compatibilityDate: "2026-11-01",
  });
  mock.state.assets.set(FONT_HASH, { contentType: "font/woff2", base64: Buffer.from("font").toString("base64") });
  await replaceSiteFiles(createDb(db.d1), {
    host: null,
    files: [{ path: FONT, hash: FONT_HASH, size: 4, contentType: "font/woff2" }],
    now: Date.now(),
  });
  const zoneBefore = () => ({
    routes: structuredClone(mock.state.routes.get(ZONE_ID) ?? []),
    dns: structuredClone(mock.state.dnsRecords.get(ZONE_ID) ?? []),
    rules: [...mock.state.rulesets.entries()]
      .filter(([key]) => key.startsWith(`${ZONE_ID}:`))
      .flatMap(([, ruleset]) => ruleset.rules),
    widgetHosts: mock.state.widgets.flatMap((widget) => widget.domains),
  });
  const before = zoneBefore();

  const page = await login();
  await page.getByRole("main").getByRole("link", { name: "Add domain" }).click();
  const picker = page.getByRole("list", { name: "Domains you can add" });
  await expect(picker.getByRole("button")).toHaveText([/example\.com/, /example\.org/]);
  await page.getByLabel("Search your domains").fill("org");
  await expect(picker.getByRole("button")).toHaveText([/example\.org/]);
  await page.getByLabel("Search your domains").fill("");
  await picker.getByRole("button", { name: /example\.com/ }).click();

  await expect(page.getByText(`${HOST} shows nothing today.`)).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: `Add ${HOST}` }).click();
  await expect(page.getByRole("heading", { name: `${HOST} is set up` })).toBeVisible({ timeout: 30_000 });
  // No address for offers yet: said plainly, with the fix one click away.
  await expect(page.getByText(`Offers for ${HOST} are saved in the inbox but not emailed yet`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Add an address" })).toHaveAttribute("href", "/admin/settings");

  const deployed = mock.deployedAssets("deparked-sites");
  expect([...deployed.keys()]).toEqual(expect.arrayContaining([`/sites/${HOST}/index.html`, FONT]));
  expect(await db.sql("SELECT status FROM domains WHERE host = ?", HOST)).toEqual([{ status: "placeholder" }]);
  expect(mock.state.routes.get(ZONE_ID)?.length).toBeGreaterThan(0);

  const visitor = await page.context().newPage();
  for (const [path, file] of deployed) await writeSiteFile(path.replace(/^\//, ""), file.body);
  await visitor.goto(hostUrl(HOST));
  await expect(visitor.getByRole("heading", { level: 1 })).toContainText(HOST);
  await visitor.close();

  await page.getByRole("link", { name: "Design its page" }).click();
  await page.getByRole("navigation", { name: "Domain" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Turn off…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Removes the route");
  await expect(dialog).toContainText(`the offers ${HOST} received`);
  await dialog.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("heading", { name: "Turned off" })).toBeVisible({ timeout: 30_000 });

  const after = mock.deployedAssets("deparked-sites");
  expect([...after.keys()].some((path) => path.startsWith(`/sites/${HOST}/`))).toBe(false);
  expect(after.has(FONT)).toBe(true);
  expect(await db.sql("SELECT path FROM site_files WHERE host = ?", HOST)).toEqual([]);
  expect(zoneBefore()).toEqual(before);
  expect(await db.sql("SELECT status FROM domains WHERE host = ?", HOST)).toEqual([{ status: "off" }]);
  await expect(page.getByRole("link", { name: "Turn on…" })).toHaveAttribute("href", `/admin/add?host=${HOST}`);
});

test("a change that stopped half-way says which one it was and offers the action that finishes it", async ({
  login,
  db,
  urls,
}) => {
  const data = createDb(db.d1);
  const now = Date.now();
  // Added half-way: off, never turned off, with a route Deparked created.
  await insertDomain(data, { domain: { host: HOST, zoneId: ZONE_ID, status: "off" }, now });
  await insertLedgerEntry(data, { host: HOST, zoneId: ZONE_ID, resource: "route", cfId: "r1", action: "created", now });
  // Turned off half-way: still live, one of its two entries undone after both were made.
  await insertDomain(data, { domain: { host: "example.org", zoneId: "zone-2", status: "live" }, now });
  for (const id of ["r2", "r3"]) {
    await insertLedgerEntry(data, { host: "example.org", resource: "route", cfId: id, action: "created", now });
  }
  await db.sql("UPDATE ledger SET undone_at = ? WHERE cf_id = 'r3'", now + 10);

  const page = await login();
  await page.goto(`${urls.admin}/admin/d/${HOST}`);
  await expect(page.getByText(`Adding ${HOST} stopped half-way`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue adding" }).first()).toHaveAttribute(
    "href",
    `/admin/add?host=${HOST}`,
  );
  await expect(page.getByRole("link", { name: "Finish turning off" })).toHaveCount(0);

  await page.goto(`${urls.admin}/admin/d/example.org`);
  await expect(page.getByText("Turning example.org off stopped half-way")).toBeVisible();
  await page.getByRole("link", { name: "Finish turning off" }).click();
  await expect(page.getByRole("heading", { name: "Finish turning off" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue adding" })).toHaveCount(0);
});
