import { createDb, insertDomain } from "@deparked/db";
import { expect, TEST_ACCOUNT_ID, TEST_TOKEN, test } from "../fixtures";

const HOST = "example.com";

test("the owner reports a problem: a summary first, then a GitHub link with anonymous diagnostics", async ({
  login,
  urls,
  db,
}) => {
  await insertDomain(createDb(db.d1), { domain: { host: HOST, zoneId: "zone-1" }, now: Date.now() });
  const page = await login();

  // The command menu leads to Settings → Help with the dialog open.
  await page.goto(`${urls.admin}/admin`);
  await page.getByRole("button", { name: "Search domains and pages" }).click();
  await page.getByRole("option", { name: "Report a problem" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/help\?report=1$/);
  const dialog = page.getByRole("dialog", { name: "Report a problem" });
  await expect(dialog).toBeVisible();

  // No link until the owner wrote what happened.
  await expect(dialog.getByRole("link", { name: /Open GitHub issue/ })).toHaveCount(0);
  const summary = dialog.getByLabel("What happened?");
  await expect(summary).toBeFocused();
  // aria-disabled, not disabled: it stays focusable and says why when pressed.
  await dialog.getByRole("button", { name: /Open GitHub issue/ }).click({ force: true });
  await expect(dialog.getByRole("alert")).toContainText("at least 20 characters");
  await summary.fill("Publishing stopped halfway and the page never went live.");
  // A stray tap beside the dialog keeps what was written.
  await page.mouse.click(4, 4);
  await expect(summary).toHaveValue("Publishing stopped halfway and the page never went live.");

  const href = await dialog.getByRole("link", { name: /Open GitHub issue/ }).getAttribute("href");
  expect(href).not.toBeNull();
  const url = new URL(href ?? "");
  expect(`${url.origin}${url.pathname}`).toBe("https://github.com/dominic-schmid/deparked/issues/new");
  expect(url.searchParams.get("template")).toBe("problem.yml");
  expect(url.searchParams.get("title")).toBe("Admin, help: Publishing stopped halfway and the page never went live.");
  expect(url.searchParams.get("summary")).toBe("Publishing stopped halfway and the page never went live.");
  const diagnostics = url.searchParams.get("diagnostics") ?? "";
  expect(diagnostics).toContain("surface: admin");
  expect(diagnostics).toContain("place: help");
  expect(diagnostics).toMatch(/^browser: Chrome \d+$/m);
  // Nothing that names the owner's domains, admin or account leaves with it.
  for (const secret of [HOST, new URL(urls.admin).host, "e2e-account"]) {
    expect(decodeURIComponent(href ?? "")).not.toContain(secret);
  }
  await expect(dialog.locator("pre")).toHaveText(diagnostics);

  // Closing the dialog leaves Help; the diagnostics are there to copy.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/admin\/settings\/help$/);
  await expect(page.getByRole("button", { name: "Copy diagnostics" })).toBeVisible();
});

test("the installer offers a report once a retry of a failed step fails too", async ({ page, urls, mock }) => {
  test.setTimeout(90_000);
  // A 400 is not retried by the client: each run of the step fails once.
  mock.failNext({ route: "workers.uploadScript", status: 400, code: 10021, times: 2, message: "upload refused" });
  await page.goto(urls.install);
  await page.getByLabel("API token").fill(TEST_TOKEN);
  await page.getByRole("button", { name: "Check the token" }).click();
  await page.getByRole("button", { name: "Install Deparked" }).click();

  const retry = page.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  const report = page.getByRole("button", { name: "Report this problem" });
  await expect(report).toHaveCount(0);

  await retry.click();
  await expect(report).toBeVisible({ timeout: 20_000 });
  await report.click();
  const diagnostics = page.getByRole("dialog", { name: "Report a problem" }).locator("pre");
  await expect(diagnostics).toContainText("surface: installer");
  await expect(diagnostics).toContainText("place: install");
  await expect(diagnostics).toContainText("attempts: 2");
  await expect(diagnostics).toContainText(/^step: [a-z-]+$/m);
  await expect(diagnostics).not.toContainText(TEST_ACCOUNT_ID);
});
