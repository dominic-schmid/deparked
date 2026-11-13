import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { CONFIG_VERSION, defaultConfig } from "@deparked/config";
import {
  createDb,
  insertDomain,
  insertTurnstileWidget,
  publishConfig,
  replaceSiteFiles,
  saveDraft,
  setDomainStatus,
} from "@deparked/db";
import type { Page } from "@playwright/test";
import { contentHash } from "../../packages/hosting/src/index";
import { expect, TURNSTILE_DUMMY_SITEKEY, TURNSTILE_SECRET_NAME, test, ZONES } from "../fixtures";
import { ROOT } from "../harness/paths";

const HOST = "example.com";
const HEADLINE = "Make {domain} yours";
const SHOWN = "Make example.com yours";

const TYPES: Record<string, string> = {
  avif: "image/avif",
  webp: "image/webp",
  woff2: "font/woff2",
  json: "application/json",
  js: "text/javascript",
  txt: "text/plain; charset=utf-8",
};

/**
 * The catalog as an install leaves it: its rows in `site_files`, which every publish sends with the domain's own
 * pages, and its files already uploaded to Cloudflare.
 */
async function catalogFiles() {
  const root = resolve(ROOT, "apps/sites/public");
  const entries = await readdir(resolve(root, "catalog"), { recursive: true, withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const file = resolve(entry.parentPath, entry.name);
        const path = `/${relative(root, file)}`;
        const content = new Uint8Array(await readFile(file));
        const extension = /\.([^./]+)$/.exec(path)?.[1] ?? "";
        const row = {
          path,
          hash: await contentHash(path, content),
          size: content.length,
          contentType: TYPES[extension] ?? "application/octet-stream",
        };
        return { row, content };
      }),
  );
}

/** Watches the page: which catalog images and fonts loaded, and whether a security policy blocked anything. */
function watchCatalog(page: Page) {
  const loaded: string[] = [];
  const blocked: string[] = [];
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/catalog/") && response.ok()) loaded.push(pathname);
  });
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) blocked.push(message.text());
  });
  return {
    blocked,
    has: (folder: string) => loaded.some((path) => path.startsWith(`/catalog/${folder}/`)),
  };
}

async function seedDomain(db: { d1: D1Database }) {
  const data = createDb(db.d1);
  const now = Date.now();
  await insertTurnstileWidget(data, {
    sitekey: TURNSTILE_DUMMY_SITEKEY,
    name: "deparked-1",
    secretName: TURNSTILE_SECRET_NAME,
    now,
  });
  const zone = ZONES.find((candidate) => candidate.name === HOST);
  await insertDomain(data, {
    domain: { host: HOST, zoneId: zone?.id ?? "", turnstileWidgetId: TURNSTILE_DUMMY_SITEKEY },
    now,
  });
  await setDomainStatus(data, { host: HOST, status: "live", now });
  return { data, now };
}

test("the preview loads the catalog's images and fonts on the admin's own address too", async ({
  login,
  page,
  db,
  urls,
}) => {
  await seedDomain(db);
  const catalog = watchCatalog(page);
  await login();
  await page.goto(`${urls.admin}/admin/d/${HOST}`);
  await expect(page.frameLocator(`iframe[title="Preview of ${HOST}"]`).getByRole("heading", { level: 1 })).toHaveText(
    HOST,
  );
  await expect.poll(() => catalog.has("backgrounds") && catalog.has("fonts")).toBe(true);
  expect(catalog.blocked).toEqual([]);
});

test("the editor keeps the form left, the device switch above the preview, and the preview shows the lander", async ({
  login,
  page,
  db,
  urls,
}) => {
  await seedDomain(db);
  await login();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${urls.admin}/admin/d/${HOST}`);
  const frame = page.locator(`iframe[title="Preview of ${HOST}"]`);
  await expect(frame).toBeVisible();
  const preview = page.frameLocator(`iframe[title="Preview of ${HOST}"]`);
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText(HOST);
  expect((await preview.locator("body").innerText()).trim().length).toBeGreaterThan(0);

  // Two columns: the form on the left, the device switch directly above the preview on the right.
  const form = await page.getByRole("form", { name: `Design of ${HOST}` }).boundingBox();
  const desktop = await page.getByRole("button", { name: "Desktop" }).boundingBox();
  const box = await frame.boundingBox();
  if (!form || !desktop || !box) throw new Error("editor parts are not laid out");
  expect(form.x + form.width).toBeLessThanOrEqual(box.x + 1);
  expect(desktop.y + desktop.height).toBeLessThanOrEqual(box.y + 1);
  expect(box.height).toBeGreaterThan(300);
  for (const device of ["Phone", "Tablet", "Desktop"]) {
    await page.getByRole("button", { name: device }).click();
    await expect(preview.getByRole("heading", { level: 1 })).toHaveText(HOST);
  }

  // On a phone the Edit and Preview tabs take over.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole("tab", { name: "Edit" })).toBeVisible();
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(frame).toBeVisible();
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText(HOST);
});

test("the owner edits a domain's headline, sees it in the preview and publishes it", async ({
  login,
  page,
  db,
  mock,
  hostUrl,
  writeSiteFile,
}) => {
  const { data, now } = await seedDomain(db);
  const files = await catalogFiles();
  const catalog = files.map((file) => file.row);
  await replaceSiteFiles(data, { host: null, files: catalog, now });
  // Cloudflare may ask for a file it had before: this one then comes from the release (`RELEASE_FILES_URL`).
  const [asked, ...uploaded] = files;
  for (const { row, content } of uploaded) {
    mock.state.assets.set(row.hash, { contentType: row.contentType, base64: Buffer.from(content).toString("base64") });
  }

  const watched = watchCatalog(page);
  await login(HOST);
  await page.goto(hostUrl(HOST, `/admin/d/${HOST}`));
  await expect(page.getByText("Not live yet", { exact: true })).toBeVisible();

  const preview = page.frameLocator(`iframe[title="Preview of ${HOST}"]`);
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText(HOST);
  await expect.poll(() => watched.has("backgrounds") && watched.has("fonts")).toBe(true);
  expect(watched.blocked).toEqual([]);

  await page.getByLabel("Headline").fill(HEADLINE);
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText(SHOWN);
  await expect(page.getByText("Saved · Not live yet", { exact: true })).toBeVisible();
  expect(await db.sql("SELECT live_json FROM config WHERE host = ?", HOST)).toEqual([{ live_json: null }]);

  await page.getByLabel("Headline").fill("");
  await expect(page.getByText("Add a headline.")).toBeVisible();
  await expect(page.getByText("Preview out of date: it shows the last version that could be rendered.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Put it live", exact: true })).toBeDisabled();
  await page.getByLabel("Headline").fill(HEADLINE);

  await page.getByRole("button", { name: "Put it live", exact: true }).click();
  await expect(page.getByText("It's live", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Live · matches your draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Earlier versions/ }).click();
  await expect(page.getByRole("listitem").filter({ hasText: SHOWN })).toContainText("live now");

  const deployed = mock.deployedAssets("deparked-sites");
  const index = deployed.get(`/sites/${HOST}/index.html`);
  expect(new TextDecoder().decode(index?.body)).toContain(SHOWN);
  for (const row of catalog) expect(deployed.has(row.path), row.path).toBe(true);
  expect(Buffer.from(deployed.get(asked?.row.path ?? "")?.body ?? [])).toEqual(Buffer.from(asked?.content ?? []));
  const [stored] = await db.sql<{ live_json: string }>("SELECT live_json FROM config WHERE host = ?", HOST);
  expect(JSON.parse(stored?.live_json ?? "{}").headline).toBe(HEADLINE);

  for (const name of ["index.html", "robots.txt", "sitemap.xml"]) {
    const file = deployed.get(`/sites/${HOST}/${name}`);
    if (file) await writeSiteFile(`sites/${HOST}/${name}`, file.body);
  }
  await page.goto(hostUrl(HOST));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SHOWN);
});

test("every variant can be picked, and the gradient variant takes the gradient presets as backgrounds", async ({
  login,
  page,
  db,
  urls,
}) => {
  await seedDomain(db);
  await login();
  await page.goto(`${urls.admin}/admin/d/${HOST}`);
  const designs = page.getByRole("radiogroup", { name: "Look" });
  for (const name of ["Sky", "Gradient", "Editorial", "Mono", "Split"]) {
    await expect(designs.getByRole("radio", { name })).toBeEnabled();
  }
  const backgrounds = page.getByRole("radiogroup", { name: "Background" });
  await designs.getByRole("radio", { name: "Gradient" }).click();
  // Sky's photo is not drawn by this look, so it is not offered: the variant's own gradient replaces it.
  await expect(backgrounds.getByRole("radio", { name: /^Dusk/ })).toBeChecked();
  await expect(backgrounds.getByRole("radio", { name: /^Sky/ })).toHaveCount(0);
  for (const name of ["Dawn", "Tide", "Meadow", "Ember", "Dusk"]) {
    await backgrounds.getByText(name, { exact: true }).click();
    await expect(backgrounds.getByRole("radio", { name: new RegExp(`^${name}`) })).toBeChecked();
  }
  await expect
    .poll(async () => {
      const [stored] = await db.sql<{ draft_json: string }>("SELECT draft_json FROM config WHERE host = ?", HOST);
      const draft = JSON.parse(stored?.draft_json ?? "{}");
      return [draft.variant, draft.background];
    })
    .toEqual(["gradient", "dusk"]);
  await expect(page.frameLocator(`iframe[title="Preview of ${HOST}"]`).locator(".field")).toHaveCSS(
    "background-image",
    /gradient/,
  );
});

test("Publish shows old and new values, the preview's links stay put, and a wait hands focus back", async ({
  login,
  page,
  db,
  hostUrl,
}) => {
  const { data, now } = await seedDomain(db);
  const live = { ...defaultConfig(), marketplaceUrl: "https://example.net/listing" };
  await saveDraft(data, { host: HOST, json: JSON.stringify(live), schemaVersion: CONFIG_VERSION, now });
  await publishConfig(data, {
    host: HOST,
    json: JSON.stringify(live),
    schemaVersion: CONFIG_VERSION,
    release: null,
    now,
  });

  await login(HOST);
  await page.goto(hostUrl(HOST, `/admin/d/${HOST}`));
  const preview = page.frameLocator(`iframe[title="Preview of ${HOST}"]`);
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText(HOST);
  await expect(page.getByText("Live · matches your draft", { exact: true })).toBeVisible();

  // A link in the preview goes nowhere and says why.
  const link = preview.locator("a[href]").first();
  await link.hover();
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  const hint = () =>
    frame?.evaluate<string>('getComputedStyle(document.body, "::after").content') ?? Promise.resolve("");
  await expect.poll(hint).toContain("This is a preview");
  await link.click();
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText(HOST);
  expect(frame?.url()).toBe("about:srcdoc");

  await page.getByLabel("Headline").fill(HEADLINE);
  // The header says how many changes are not live yet; they open as old and new values.
  await page.getByRole("button", { name: "1 change not live yet" }).click();
  const changes = page.getByRole("listitem").filter({ hasText: "Headline" }).first();
  await expect(page.getByText("Putting it live changes 1 field:")).toBeVisible();
  await expect(changes).toContainText(`“${live.headline}”`);
  await expect(changes).toContainText(`“${HEADLINE}”`);
  await page.keyboard.press("Escape");
  await expect(page.getByText(/^Saved ·/)).toBeVisible();

  // Another publish holds the lock: waiting for it ends with a notice, focus on Publish, and nothing published.
  const [deployment] = await db.sql<{ id: number }>(
    "INSERT INTO deployments (worker, kind, status, started_at) VALUES ('sites', 'publish', 'running', ?) RETURNING id",
    now,
  );
  await db.sql(
    "INSERT INTO publish_lock (id, deployment_id, expires_at) VALUES (1, ?, ?)",
    deployment?.id ?? 0,
    now + 60_000,
  );
  const publish = page.getByRole("button", { name: "Put it live", exact: true });
  await publish.click();
  await expect(page.getByText("Another publish is running", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Wait until it has finished" }).click();
  await expect(page.getByText("Waiting for the other publish to finish…")).toBeVisible();
  await db.sql("DELETE FROM publish_lock");
  await expect(page.getByText("The other publish has finished.", { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect(publish).toBeFocused();
  expect(await db.sql("SELECT json_extract(live_json, '$.headline') AS headline FROM config")).toEqual([
    { headline: live.headline },
  ]);
});
