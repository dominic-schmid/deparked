import { createDb, insertDomain, insertTurnstileWidget, setDomainStatus } from "@deparked/db";
import {
  expect,
  TEST_RELEASE,
  TEST_RELEASE_NEXT,
  TEST_TOKEN,
  TURNSTILE_DUMMY_SITEKEY,
  TURNSTILE_SECRET_NAME,
  test,
  ZONES,
} from "../fixtures";

const HOST = "example.com";
const PAGE = `/sites/${HOST}/index.html`;

test("updates from one release to the next from Settings, republishes every page, then rolls back", async ({
  page,
  urls,
  mock,
  db,
  login,
  releases,
  setLatestRelease,
}) => {
  test.setTimeout(120_000);
  // Release A, installed through the installer as the owner does it.
  await page.goto(urls.install);
  await page.getByLabel("API token").fill(TEST_TOKEN);
  await page.getByRole("button", { name: "Check the token" }).click();
  await page.getByRole("button", { name: "Install Deparked" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Deparked is installed" })).toBeVisible({ timeout: 20_000 });

  // A live domain, so "publish every page again" has a page to publish.
  const data = createDb(db.d1);
  const now = Date.now();
  await insertTurnstileWidget(data, {
    sitekey: TURNSTILE_DUMMY_SITEKEY,
    name: "deparked-1",
    secretName: TURNSTILE_SECRET_NAME,
    now,
  });
  await insertDomain(data, {
    domain: { host: HOST, zoneId: ZONES[0]?.id ?? "", turnstileWidgetId: TURNSTILE_DUMMY_SITEKEY },
    now,
  });
  await setDomainStatus(data, { host: HOST, status: "live", now });

  // The newest release on "GitHub" is the one installed.
  setLatestRelease(TEST_RELEASE);
  await login();
  await page.goto(`${urls.admin}/admin/settings/updates`);
  await expect(page.getByText(`Deparked ${TEST_RELEASE}`, { exact: true })).toBeVisible();
  await expect(page.getByText("You have the newest release.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Update available/ })).toHaveCount(0);

  // Release B appears on "GitHub": the admin shows it with its checksum, and installs nothing yet.
  setLatestRelease(TEST_RELEASE_NEXT);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("heading", { name: `Update available: Deparked ${TEST_RELEASE_NEXT}` })).toBeVisible();
  await expect(page.getByText(releases[TEST_RELEASE_NEXT] ?? "missing", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review the update" }).click();
  await expect(page.getByRole("heading", { name: "What will change" })).toBeVisible();
  await expect(page.getByText(/Database changes only go forward/)).toBeVisible();

  const install = page.getByRole("button", { name: `Install Deparked ${TEST_RELEASE_NEXT}` });
  await install.click();
  await expect(page.getByRole("alert")).toContainText("Tick the box");
  expect(await db.sql("SELECT change_kind FROM release_state")).toEqual([{ change_kind: null }]);
  await page.getByLabel("The checksum above is the one in the release notes on GitHub.").check();
  await install.click();

  const started = Date.now();
  await expect(page.getByText(`Deparked ${TEST_RELEASE_NEXT} is installed`)).toBeVisible({ timeout: 60_000 });
  const release = () =>
    mock.liveBindings("deparked-admin").find((binding) => binding.name === "DEPARKED_RELEASE")?.text;
  expect(release()).toBe(TEST_RELEASE_NEXT);
  expect(await db.sql("SELECT installed_release FROM workspace")).toEqual([{ installed_release: TEST_RELEASE_NEXT }]);
  // Every page was published again, after the update started.
  expect(mock.deployedAssets("deparked-sites").has(PAGE)).toBe(true);
  const [row] = await db.sql<{ updated_at: number }>("SELECT updated_at FROM site_files WHERE path = ?", PAGE);
  expect(row?.updated_at ?? 0).toBeGreaterThanOrEqual(started - 60_000);

  // Settings now shows B, and the way back to A.
  await page.reload();
  await expect(page.getByText(`Deparked ${TEST_RELEASE_NEXT}`, { exact: true })).toBeVisible();
  await expect(page.getByText("You have the newest release.")).toBeVisible();
  await page.getByRole("button", { name: `Roll back to ${TEST_RELEASE}` }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("The database stays as");
  await dialog.getByRole("button", { name: "Roll back" }).click();
  await expect(page.getByText(`Deparked ${TEST_RELEASE} is installed`)).toBeVisible({ timeout: 60_000 });
  expect(release()).toBe(TEST_RELEASE);
  expect(await db.sql("SELECT installed_release FROM workspace")).toEqual([{ installed_release: TEST_RELEASE }]);

  // Back on A, B is offered again; a rollback is not.
  await page.reload();
  await expect(page.getByRole("heading", { name: `Update available: Deparked ${TEST_RELEASE_NEXT}` })).toBeVisible();
  await expect(page.getByRole("button", { name: /Roll back/ })).toHaveCount(0);
});
