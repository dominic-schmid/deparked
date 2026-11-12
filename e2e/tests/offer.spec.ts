import { createRequire } from "node:module";
import { resolve } from "node:path";
import { type Config, defaultConfig, MINOR_UNITS_PER_MAJOR } from "@deparked/config";
import {
  createDb,
  insertDomain,
  insertNotifyAddress,
  insertTurnstileWidget,
  publishConfig,
  setDomainStatus,
} from "@deparked/db";
import { build } from "esbuild";
import { expect, TURNSTILE_DUMMY_SITEKEY, TURNSTILE_SECRET_NAME, test } from "../fixtures";
import { ROOT, TMP } from "../harness/paths";

const HOST = "example.com";
const NOTIFY = "owner@example.com";
const RENDERER = resolve(TMP, "lander-renderer.cjs");
const TOKEN = "e2e-turnstile-token";

// Stands in for Turnstile's script, which CI cannot load: renders nothing and passes a moment after `execute`.
const TURNSTILE_STUB = `window.turnstile = {
  render(box, options) { this.options = options; return "widget"; },
  execute() { setTimeout(() => this.options.callback(${JSON.stringify(TOKEN)}), 20); },
  reset() {},
};`;

// The part of `tests/lander/renderer-entry.ts` used here. Not its own types: they need the DOM and JSX settings.
type Renderer = {
  catalog: unknown;
  render(config: Config, host: string, options: { catalog: unknown; sitekey: string }): { "index.html": string };
};

// Playwright compiles JSX for its own component runner, so the renderer is bundled first, as in `tests/lander`.
test.beforeAll(async () => {
  await build({
    entryPoints: [resolve(ROOT, "tests/lander/renderer-entry.ts")],
    outfile: RENDERER,
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
});

test("a visitor's offer is checked, stored and sent to the owner", async ({
  page,
  hostUrl,
  db,
  mock,
  writeSiteFile,
}) => {
  const { render, catalog }: Renderer = createRequire(import.meta.url)(RENDERER);
  const config = defaultConfig();
  const now = Date.now();
  const database = createDb(db.d1);
  await insertNotifyAddress(database, { email: NOTIFY, verifiedAt: now, now });
  await insertTurnstileWidget(database, {
    sitekey: TURNSTILE_DUMMY_SITEKEY,
    name: "deparked-1",
    secretName: TURNSTILE_SECRET_NAME,
    now,
  });
  await insertDomain(database, {
    domain: { host: HOST, zoneId: "zone-e2e", turnstileWidgetId: TURNSTILE_DUMMY_SITEKEY, notifyEmail: NOTIFY },
    now,
  });
  await publishConfig(database, {
    host: HOST,
    json: JSON.stringify(config),
    schemaVersion: config.version,
    release: "e2e",
    now,
  });
  await setDomainStatus(database, { host: HOST, status: "live", now });
  mock.state.siteverify = { success: true, hostname: HOST };

  const files = render(config, HOST, { catalog, sitekey: TURNSTILE_DUMMY_SITEKEY });
  await writeSiteFile(`sites/${HOST}/index.html`, files["index.html"]);
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB }),
  );
  await page.goto(hostUrl(HOST));
  await expect(page.locator("form")).toHaveAttribute("novalidate", "");

  // The page checks the minimum itself, so the server's own check is asked directly, from the page's origin.
  const below = await page.evaluate(
    async ({ amount, token }) => {
      const response = await fetch("/api/offer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount,
          name: "Ada Example",
          email: "ada@example.com",
          website: "",
          "cf-turnstile-response": token,
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { amount: config.minOffer - 1, token: TOKEN },
  );
  expect(below).toEqual({
    status: 400,
    body: { ok: false, error: "Offers start at €1,000", code: "min-offer", field: "amount" },
  });
  expect(await db.sql("SELECT id FROM offers")).toEqual([]);

  await page.locator('input[name="amount"]').fill("12500");
  await page.locator('input[name="name"]').fill("Ada Example");
  await page.locator('input[name="email"]').fill("ada@example.com");
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    "Thanks, Ada Example. Your €12,500 offer is with the owner.",
  );

  expect(
    await db.sql("SELECT host, amount_minor, currency, name, email, status, email_status, notified_to FROM offers"),
  ).toEqual([
    {
      host: HOST,
      amount_minor: 12_500 * MINOR_UNITS_PER_MAJOR,
      currency: config.currency,
      name: "Ada Example",
      email: "ada@example.com",
      status: "new",
      email_status: "sent",
      notified_to: NOTIFY,
    },
  ]);
  expect(mock.callsTo("turnstile.siteverify")).toHaveLength(1);
});
