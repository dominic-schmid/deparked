import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { type Config, defaultConfig, LIMITS, parseConfig } from "@deparked/config";
import type { RenderOptions } from "@deparked/templates";
import type { Page, Request } from "@playwright/test";
import { RENDERER } from "./global-setup";

const { render, variants, catalog }: typeof import("./renderer-entry") = createRequire(import.meta.url)(RENDERER);

export { variants };

const PUBLIC = fileURLToPath(new URL("../../apps/sites/public", import.meta.url));
export const ORIGIN = "https://lander.test";
// Cloudflare's documented test sitekey (always passes) and the token its test widget returns.
export const SITEKEY = "1x00000000000000000000AA";
export const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
export const options: RenderOptions = { catalog, sitekey: SITEKEY };

// Stands in for Turnstile's script: renders nothing and passes a moment after `execute`.
const TURNSTILE_STUB = `window.turnstile = {
  render(box, options) { this.options = options; return "widget"; },
  execute() { setTimeout(() => this.options.callback(${JSON.stringify(TOKEN)}), 20); },
  reset() {},
};`;

export type OfferReply = { status: number; headers?: Record<string, string>; body?: string };

/**
 * Serves one rendered page at https://lander.test/ with the real catalog files beside it, a stub Turnstile and
 * `reply` as the offer endpoint. Returns the offer requests the page made.
 */
export async function serve(page: Page, html: string, reply?: (request: Request) => OfferReply): Promise<Request[]> {
  const offers: Request[] = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "challenges.cloudflare.com") {
      return route.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB });
    }
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === "/" && request.method() === "GET")
      return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/offer" && request.method() === "POST") {
      offers.push(request);
      return route.fulfill(reply?.(request) ?? { status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    const file = `${PUBLIC}${url.pathname}`;
    return url.pathname.startsWith("/catalog/") && existsSync(file)
      ? route.fulfill({ path: file })
      : route.fulfill({ status: 404, body: "" });
  });
  return offers;
}

export async function open(page: Page, html: string, reply?: (request: Request) => OfferReply): Promise<Request[]> {
  const offers = await serve(page, html, reply);
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => document.fonts.ready);
  return offers;
}

function valid(config: unknown): Config {
  const result = parseConfig(config);
  if (!result.ok) throw new Error(`worst-case config is not valid: ${JSON.stringify(result.errors)}`);
  return result.config;
}

const fill = (text: string, length: number) =>
  text
    .repeat(Math.ceil(length / text.length))
    .slice(0, length)
    .trim();

/** What a buyer types, at its worst: a long hyphenated name, an unbreakable address, the largest amount. */
export const BUYER = {
  amount: "999999999",
  name: "Aleksandra Wiśniewska-Kowalczyk",
  email: "bartholomew.fitzgerald@northwind-industries-holdings.example.com",
};

/** The configs every variant has to survive: realistic worst cases, each at a limit the schema enforces. */
export const CASES: { name: string; host: string; config: Config }[] = [
  { name: "default", host: "example.com", config: defaultConfig() },
  { name: "short domain", host: "x.io", config: defaultConfig() },
  {
    name: "longest domain",
    host: "the-international-association-of-very-long-domain-names.example",
    config: defaultConfig(),
  },
  {
    name: "copy at its limits",
    host: "northwind-industries-holdings.example",
    config: valid({
      ...defaultConfig(),
      headline: fill("The Northwind Industries Holdings portfolio of premium names ", LIMITS.headline),
      sentence: fill(
        "On behalf of our acquisitions team I would like to make a binding offer of {amount} for {domain}; I am {name}, reachable at {email}, and our counsel will follow up with the paperwork in due course, thank you ",
        LIMITS.sentence,
      ),
      escrowLine: fill(
        "The owner reads every offer and replies by email within two working days. Payment through Escrow.com, transfer by auth code after the funds have cleared in full. ",
        LIMITS.escrowLine,
      ),
      marketplaceUrl: "https://marketplace.northwind-industries-holdings.example/listings/premium",
      seo: {
        title: fill("{domain} is for sale ", LIMITS.seoTitle),
        description: fill("Buy {domain}. ", LIMITS.seoDescription),
      },
    }),
  },
  {
    name: "huge amounts",
    host: "example.com",
    config: valid({ ...defaultConfig(), currency: "CHF", minOffer: LIMITS.minOffer }),
  },
  {
    name: "right-to-left copy",
    host: "example.com",
    config: valid({
      ...defaultConfig(),
      headline: "هذا النطاق المميز معروض للبيع الآن",
      sentence: "أود شراء {domain} مقابل {amount}. اسمي {name} ويمكنكم التواصل معي على {email}.",
      escrowLine: "يقرأ المالك كل عرض ويرد عبر البريد الإلكتروني. الدفع عبر Escrow.com.",
    }),
  },
];

export const html = (config: Config, host: string): string => render(config, host, options)["index.html"];
