import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { type Config, defaultConfig, LIMITS, parseConfig, VARIANTS } from "@deparked/config";
import { describe, expect, it } from "vitest";
import { type RenderOptions, render, renderPlaceholder, variants } from "./index";
import { catalog } from "./release-catalog";

const PUBLIC = new URL("../../../apps/sites/public", import.meta.url).pathname;
// Cloudflare's documented always-passes test sitekey.
const options: RenderOptions = { catalog, sitekey: "1x00000000000000000000AA" };
const gzipped = (text: string | Buffer) => gzipSync(text, { level: 9 }).length;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("render", () => {
  it("renders Sky with the default config", () => {
    const files = render(defaultConfig(), "example.com", options);
    expect(Object.keys(files)).toEqual(["index.html", "robots.txt", "sitemap.xml"]);
    expect(files["index.html"]).toMatchSnapshot();
  });

  it("puts the copy, the price floor and a working form in the HTML itself", () => {
    const html = render(defaultConfig(), "example.com", options)["index.html"];
    expect(html).toMatch(/^<!doctype html><html lang="en">/);
    expect(html).toMatch(/<h1[^>]*>example\.com<\/h1>/);
    expect(html).toContain("I&#x27;d like to buy example.com for ");
    expect(html).toContain("The owner reads every offer and replies by email. Payment through Escrow.com.");
    expect(html).toMatch(/<form action="\/api\/offer" method="post">/);
    for (const name of ["amount", "name", "email", "website"]) expect(html).toContain(`name="${name}"`);
    expect(html).toMatch(/<button class="send" type="submit">/);
    expect(html).toContain("Offers start at €1,000");
  });

  it("describes the page to search engines and link previews", () => {
    const html = render(defaultConfig(), "example.com", options)["index.html"];
    expect(html).toContain("<title>example.com is for sale</title>");
    expect(html).toContain(
      '<meta name="description" content="The domain example.com is for sale. Send the owner an offer."/>',
    );
    expect(html).toContain('<link rel="canonical" href="https://example.com/"/>');
    expect(html).toContain('<meta property="og:title" content="example.com is for sale"/>');
    expect(html).toMatch(
      /<meta property="og:image" content="https:\/\/example\.com\/catalog\/backgrounds\/sky-1280\.\w+\.webp"\/>/,
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    expect(html).toContain('<meta name="theme-color" content="#7f9fbf"/>');
    expect(html).not.toContain("noindex");
    const jsonLd = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(JSON.parse(jsonLd)).toMatchObject({
      "@type": "WebPage",
      url: "https://example.com/",
      name: "example.com is for sale",
    });
  });

  it("loads nothing from a third party but Turnstile, and the beacon only with a token", () => {
    const external = (html: string) =>
      [...html.matchAll(/(?:src|href)="(https?:\/\/[^"/]+)/g)].map((match) => match[1]);
    const html = render(defaultConfig(), "example.com", options)["index.html"];
    expect(new Set(external(html))).toEqual(new Set(["https://example.com", "https://challenges.cloudflare.com"]));
    const withBeacon = render(defaultConfig(), "example.com", { ...options, beaconToken: "test-token" })["index.html"];
    expect(withBeacon).toContain(
      '<script defer="" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon="{&quot;token&quot;:&quot;test-token&quot;}"></script>',
    );
  });

  it("self-hosts its fonts, preloads the first paint's and swaps the rest in", () => {
    const html = render(defaultConfig(), "example.com", options)["index.html"];
    expect(html.match(/<link rel="preload" as="font"/g)).toHaveLength(2);
    expect(html.match(/@font-face/g)?.length).toBeGreaterThan(0);
    expect(html.match(/@font-face/g)?.length).toBe(html.match(/font-display:swap/g)?.length);
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)/);
  });

  it("uses the options it is given", () => {
    const html = render(defaultConfig(), "example.com", {
      ...options,
      offerEndpoint: "/offers",
      sitekey: "3x00000000000000000000FF",
    })["index.html"];
    expect(html).toContain('action="/offers"');
    expect(html).toContain("3x00000000000000000000FF");
  });

  it("applies an accent, another currency and a marketplace link", () => {
    const config: Config = {
      ...defaultConfig(),
      currency: "CHF",
      minOffer: 2500000,
      marketplaceUrl: "https://www.example.org/listing/1",
      accent: { primary: "#112233", contrast: "#ffeedd" },
    };
    const html = render(config, "example.com", options)["index.html"];
    expect(html).toContain('<meta name="theme-color" content="#112233"/>');
    expect(html).toContain("--accent:#112233");
    expect(html).toContain("Offers start at CHF\u00a02,500,000");
    expect(html).toContain("Offer in Swiss francs");
    expect(html).toMatch(
      /<a href="https:\/\/www\.example\.org\/listing\/1" rel="noopener noreferrer">Also listed on example\.org<\/a>/,
    );
  });

  it("falls back to a flat colour when the background is not in the catalog", () => {
    const html = render({ ...defaultConfig(), background: "gone" }, "example.com", options)["index.html"];
    expect(html).not.toContain("<picture");
    expect(html).toContain('<meta name="twitter:card" content="summary"/>');
  });

  it("renders every variant the schema names, as Sky until it has its own design", () => {
    for (const variant of VARIANTS) {
      const html = render({ ...defaultConfig(), variant }, "example.com", options)["index.html"];
      expect(html).toContain("<h1");
      if (!(variant in variants)) expect(html).toContain(catalog.islands.sky?.path);
    }
  });

  it("is pure: the same input gives the same bytes and is left untouched", () => {
    const config = deepFreeze(defaultConfig());
    const frozen = deepFreeze(structuredClone(options));
    expect(render(config, "example.com", frozen)).toEqual(render(config, "example.com", frozen));
  });

  it("never turns owner input or the host into markup", () => {
    const hostile = `"><i data-x='pwn'></i><script>alert(1)</script></style></title>&{amount}`;
    const config = {
      ...defaultConfig(),
      background: hostile,
      headline: hostile,
      sentence: `${hostile} {amount} ${hostile} {name} ${hostile} {email} ${hostile}`,
      escrowLine: hostile,
      marketplaceUrl: `javascript:alert(1)//${hostile}`,
      seo: { title: hostile, description: hostile },
      accent: { primary: hostile, contrast: hostile },
      currency: hostile,
    } as unknown as Config;
    const clean = render(defaultConfig(), "example.com", options);
    const files = render(config, hostile, {
      ...options,
      sitekey: hostile,
      beaconToken: hostile,
      offerEndpoint: hostile,
    });
    const html = files["index.html"];
    const tags = (text: string, tag: string) => text.match(new RegExp(`<${tag}[\\s>]`, "g"))?.length ?? 0;
    expect(html).not.toContain("<i data-x");
    expect(html).not.toContain('href="javascript:');
    // one more script than the clean page: the beacon
    expect(tags(html, "script")).toBe(tags(clean["index.html"], "script") + 1);
    for (const tag of ["style", "title", "form", "h1"]) expect(tags(html, tag)).toBe(1);
    expect(html.match(/<\/(style|title)>/g)).toHaveLength(2);
    expect(files["robots.txt"].split("\n")).toHaveLength(clean["robots.txt"].split("\n").length);
    expect(files["sitemap.xml"].match(/</g)).toHaveLength(clean["sitemap.xml"].match(/</g)?.length ?? 0);
    expect(renderPlaceholder(hostile)["index.html"]).not.toContain("<i data-x");
  });

  it("stays within the HTML budget, also with the longest copy the schema allows", () => {
    const longest = parseConfig({
      ...defaultConfig(),
      headline: "W".repeat(LIMITS.headline),
      sentence: `{amount} {name} {email} ${"W".repeat(LIMITS.sentence - 24)}`,
      escrowLine: "W".repeat(LIMITS.escrowLine),
      marketplaceUrl: `https://example.org/${"w".repeat(LIMITS.marketplaceUrl - 20)}`,
      seo: { title: "W".repeat(LIMITS.seoTitle), description: "W".repeat(LIMITS.seoDescription) },
    });
    if (!longest.ok) throw new Error(JSON.stringify(longest.errors));
    const budget = 30 * 1024;
    expect(gzipped(render(defaultConfig(), "example.com", options)["index.html"])).toBeLessThan(budget);
    expect(gzipped(render(longest.config, `${"w".repeat(56)}.com`, options)["index.html"])).toBeLessThan(budget);
    expect(gzipped(renderPlaceholder("example.com")["index.html"])).toBeLessThan(budget);
  });
});

describe("robots.txt and sitemap.xml", () => {
  const files = render(defaultConfig(), "example.com", options);

  it("keep crawlers out of the admin and point at the sitemap", () => {
    expect(files["robots.txt"]).toBe(
      "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: https://example.com/sitemap.xml\n",
    );
  });

  it("list the one page", () => {
    expect(files["sitemap.xml"]).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/</loc></url>\n</urlset>\n',
    );
  });
});

describe("renderPlaceholder", () => {
  const files = renderPlaceholder("example.com");

  it("names the domain and links to the admin", () => {
    expect(files["index.html"]).toMatch(/<h1[^>]*>example\.com<\/h1>/);
    expect(files["index.html"]).toMatch(/<a href="\/admin"/);
    expect(files["index.html"]).not.toContain("<script");
  });

  it("stays out of search engines", () => {
    expect(files["index.html"]).toContain('<meta name="robots" content="noindex"/>');
    expect(files["robots.txt"]).toBe("User-agent: *\nDisallow: /\n");
    expect(files["sitemap.xml"]).not.toContain("<url>");
  });
});

describe("the catalog", () => {
  const files = [
    ...catalog.backgrounds.flatMap((background) => [...background.formats.avif, ...background.formats.webp]),
    ...catalog.fonts.flatMap((font) => font.files),
    ...Object.values(catalog.islands),
  ];

  it("resolves the default config's background", () => {
    expect(catalog.backgrounds.map((background) => background.id)).toContain(defaultConfig().background);
  });

  it("lists only files that exist, named by the hash of their content", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const bytes = readFileSync(`${PUBLIC}${file.path}`);
      expect(bytes.length, file.path).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex").slice(0, 12), file.path).toBe(file.hash);
      expect(file.path).toContain(`.${file.hash}.`);
    }
  });

  it("has no file the manifest does not list", () => {
    const listed = new Set(files.map((file) => file.path));
    for (const folder of ["backgrounds", "fonts", "islands"]) {
      for (const name of readdirSync(`${PUBLIC}/catalog/${folder}`)) {
        if (!name.startsWith("OFL-")) expect(listed, name).toContain(`/catalog/${folder}/${name}`);
      }
    }
  });

  it("has the fonts every variant asks for, each under a free licence", () => {
    const ids = catalog.fonts.map((font) => font.id);
    for (const variant of Object.values(variants)) for (const font of variant.fonts) expect(ids).toContain(font.id);
    for (const font of catalog.fonts) expect(["OFL-1.1", "Apache-2.0"]).toContain(font.license);
  });

  it("keeps every variant's island bundle within its budget", () => {
    for (const variant of Object.keys(variants) as (keyof typeof variants)[]) {
      const hasIslands = existsSync(new URL(`./variants/${variant}/client.ts`, import.meta.url));
      expect(Boolean(catalog.islands[variant]), variant).toBe(hasIslands);
    }
    for (const island of Object.values(catalog.islands)) {
      expect(gzipped(readFileSync(`${PUBLIC}${island.path}`)), island.path).toBeLessThan(90 * 1024);
    }
  });
});
