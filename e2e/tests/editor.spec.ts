import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createDb, insertDomain, insertTurnstileWidget, replaceSiteFiles, setDomainStatus } from "@deparked/db";
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

test("the owner edits a domain's headline, sees it in the preview and publishes it", async ({
  login,
  page,
  db,
  mock,
  hostUrl,
  writeSiteFile,
}) => {
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
  const files = await catalogFiles();
  const catalog = files.map((file) => file.row);
  await replaceSiteFiles(data, { host: null, files: catalog, now });
  // Cloudflare may ask for a file it had before: this one then comes from the release (`RELEASE_FILES_URL`).
  const [asked, ...uploaded] = files;
  for (const { row, content } of uploaded) {
    mock.state.assets.set(row.hash, { contentType: row.contentType, base64: Buffer.from(content).toString("base64") });
  }

  await login(HOST);
  await page.goto(hostUrl(HOST, `/admin/d/${HOST}`));
  await expect(page.getByText("Not published yet.")).toBeVisible();

  const preview = page.frameLocator(`iframe[title="Preview of ${HOST}"]`);
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText(HOST);

  await page.getByLabel("Headline").fill(HEADLINE);
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText(SHOWN);
  await expect(page.getByText("Draft saved")).toBeVisible();
  expect(await db.sql("SELECT live_json FROM config WHERE host = ?", HOST)).toEqual([{ live_json: null }]);

  await page.getByLabel("Headline").fill("");
  await expect(page.getByText("Add a headline.")).toBeVisible();
  await expect(page.getByText("Showing the last valid version.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await page.getByLabel("Headline").fill(HEADLINE);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("The draft matches the live page.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: SHOWN })).toContainText("Latest");

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
