// The landers' Lighthouse gate (DOM-357): every registered variant, rendered from the default config, on mobile
// (mid-range 4G, below) and desktop (Lighthouse's desktop preset). Fails below SEO 100 or performance 95, at an LCP of 1.5 s or more, a CLS of 0.01 or more, or on a font
// from another origin. HTML and island sizes are checked by the templates' Vitest budgets.
//
//   node scripts/lighthouse.ts [--variant gradient] [--reports <dir>]   (--reports keeps each full report as JSON)
//
// Runs Playwright's Chromium (never downloads one) against a local server. `example.com` resolves to that server, so
// the canonical URL, robots.txt and sitemap are the published ones. Turnstile's script is blocked: it is a third
// party loaded after the page, and CI cannot reach it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import bundleRenderer, { RENDERER } from "../tests/lander/global-setup.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PUBLIC = resolve(ROOT, "apps/sites/public");
const HOST = "example.com";
const SITEKEY = "1x00000000000000000000AA";

const GATES = { seo: 1, performance: 0.95, lcpMs: 1500, cls: 0.01 };

/**
 * "LCP under 1.5 s on mid-range 4G" (decision doc section 9; DOM-357 states the 1.5 s). Lighthouse has no preset of
 * that name: its mobile default is "Slow 4G" (150 ms, 1.6 Mbit/s). Mid-range 4G here is Chrome DevTools' "Fast 4G"
 * network (60 ms round trip, 9 Mbit/s down, 1.5 Mbit/s up) on Lighthouse's mid-tier phone (CPU 4x slower than the
 * desktop that calibrates it). Simulated throttling, as Lighthouse does by default.
 */
const MID_RANGE_4G = {
  rttMs: 60,
  throughputKbps: 9000,
  requestLatencyMs: 60 * 2.75,
  downloadThroughputKbps: 9000 * 0.9,
  uploadThroughputKbps: 1500 * 0.9,
  cpuSlowdownMultiplier: 4,
};
const mobileConfig = { extends: "lighthouse:default", settings: { throttling: MID_RANGE_4G } };

const TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".js": "text/javascript",
  ".json": "application/json",
};

const { values } = parseArgs({ options: { variant: { type: "string" }, reports: { type: "string" } } });

await bundleRenderer();
const { render, variants, catalog, defaultConfig } = createRequire(import.meta.url)(
  RENDERER,
) as typeof import("../tests/lander/renderer-entry.ts");
const ids = Object.keys(variants).filter((id) => values.variant === undefined || id === values.variant);
if (ids.length === 0) throw new Error(`No variant ${values.variant}.`);

// Cloudflare compresses text assets for browsers that accept it; serving them raw would overstate every download.
const COMPRESSED = new Set(["text/html", "text/plain", "text/javascript", "application/json"]);

function send(request: IncomingMessage, response: ServerResponse, type: string, body: Buffer | string, cache = "") {
  const headers: Record<string, string> = { "content-type": type, ...(cache === "" ? {} : { "cache-control": cache }) };
  const gzip = COMPRESSED.has(type.split(";")[0] ?? "") && /\bgzip\b/.test(request.headers["accept-encoding"] ?? "");
  response.writeHead(200, gzip ? { ...headers, "content-encoding": "gzip", vary: "accept-encoding" } : headers);
  response.end(gzip ? gzipSync(body) : body);
}

let files: Record<string, string> = {};
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const page = path === "/" ? files["index.html"] : files[path.slice(1)];
  if (page !== undefined) {
    send(request, response, path === "/" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8", page);
    return;
  }
  const file = resolve(PUBLIC, `.${path}`);
  if (path.startsWith("/catalog/") && file.startsWith(`${PUBLIC}/catalog/`) && existsSync(file)) {
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    send(request, response, type, readFileSync(file), "public, max-age=31536000, immutable");
    return;
  }
  response.writeHead(404).end();
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const { port } = server.address() as AddressInfo;

const chrome = await chromeLauncher.launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ["--headless=new", "--no-sandbox", `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${port}`],
});

type Result = {
  variant: string;
  form: string;
  seo: number;
  performance: number;
  lcpMs: number;
  cls: number;
  fonts: string[];
};
const results: Result[] = [];
try {
  for (const variant of ids) {
    files = render({ ...defaultConfig(), variant }, HOST, { catalog, sitekey: SITEKEY });
    for (const form of ["mobile", "desktop"] as const) {
      const run = await lighthouse(
        `http://${HOST}:${port}/`,
        {
          port: chrome.port,
          onlyCategories: ["performance", "seo"],
          blockedUrlPatterns: ["*challenges.cloudflare.com*"],
          logLevel: "error",
        },
        form === "desktop" ? desktopConfig : mobileConfig,
      );
      if (run === undefined) throw new Error(`Lighthouse returned nothing for ${variant} on ${form}.`);
      const { categories, audits } = run.lhr;
      if (values.reports !== undefined) {
        mkdirSync(values.reports, { recursive: true });
        writeFileSync(resolve(values.reports, `${variant}-${form}.json`), JSON.stringify(run.lhr));
      }
      const requests = (audits["network-requests"]?.details as { items?: { url: string; resourceType?: string }[] })
        ?.items;
      results.push({
        variant,
        form,
        seo: categories.seo?.score ?? 0,
        performance: categories.performance?.score ?? 0,
        lcpMs: audits["largest-contentful-paint"]?.numericValue ?? Number.POSITIVE_INFINITY,
        cls: audits["cumulative-layout-shift"]?.numericValue ?? Number.POSITIVE_INFINITY,
        fonts: (requests ?? [])
          .filter((item) => item.resourceType === "Font" && new URL(item.url).host !== `${HOST}:${port}`)
          .map((item) => item.url),
      });
    }
  }
} finally {
  await chrome.kill();
  server.close();
}

let failed = false;
for (const result of results) {
  const problems = [
    result.seo < GATES.seo && `SEO ${Math.round(result.seo * 100)} < 100`,
    result.performance < GATES.performance && `performance ${Math.round(result.performance * 100)} < 95`,
    result.lcpMs >= GATES.lcpMs && `LCP ${Math.round(result.lcpMs)} ms >= 1500 ms`,
    result.cls >= GATES.cls && `CLS ${result.cls.toFixed(3)} >= 0.01`,
    result.fonts.length > 0 && `third-party fonts: ${result.fonts.join(", ")}`,
  ].filter(Boolean);
  failed ||= problems.length > 0;
  console.log(
    `${problems.length === 0 ? "ok  " : "FAIL"} ${result.variant.padEnd(10)} ${result.form.padEnd(8)} SEO ${Math.round(result.seo * 100)} · perf ${Math.round(result.performance * 100)} · LCP ${Math.round(result.lcpMs)} ms · CLS ${result.cls.toFixed(3)}${problems.length === 0 ? "" : ` — ${problems.join("; ")}`}`,
  );
}
process.exitCode = failed ? 1 : 0;
