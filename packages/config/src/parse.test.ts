import { describe, expect, it } from "vitest";
import { CONFIG_VERSION, CURRENCIES, defaultConfig, LIMITS, parseConfig, VARIANTS } from "./index";

function errorsFor(change: Record<string, unknown>): Record<string, string> {
  const result = parseConfig({ ...defaultConfig(), ...change });
  return result.ok ? {} : result.errors;
}

describe("defaultConfig", () => {
  it("parses unchanged", () => {
    expect(parseConfig(defaultConfig())).toEqual({ ok: true, config: defaultConfig() });
  });

  it("reproduces wrappr.app without naming a host", () => {
    const config = defaultConfig();
    expect(config).toMatchObject({ version: CONFIG_VERSION, variant: "sky", currency: "EUR", minOffer: 1000 });
    expect(JSON.stringify(config)).not.toContain("wrappr");
  });

  it("returns a fresh object each time", () => {
    defaultConfig().seo.title = "changed";
    expect(defaultConfig().seo.title).toBe("{domain} is for sale");
  });
});

describe("parseConfig", () => {
  it("accepts every variant and currency in the exported lists", () => {
    for (const variant of VARIANTS) expect(errorsFor({ variant })).toEqual({});
    for (const currency of CURRENCIES) expect(errorsFor({ currency })).toEqual({});
  });

  it("gives each field one plain message", () => {
    const result = parseConfig({
      version: 99,
      variant: "neon",
      background: "../etc/passwd",
      headline: "  ",
      sentence: "Buy it for {amount}",
      currency: "BTC",
      minOffer: 12.5,
      escrowLine: 7,
      marketplaceUrl: "http://example.com/listing",
      seo: { title: "", description: "x".repeat(LIMITS.seoDescription + 1) },
      accent: { primary: "red", contrast: "#12345" },
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        version: "This config is from a different version of Deparked. Reload the page and try again.",
        variant: "Pick one of the designs.",
        background: "Pick a background from the list.",
        headline: "Add a headline.",
        sentence: "Use each of {amount}, {name}, {email} exactly once: they become the form fields.",
        currency: "Pick a currency from the list.",
        minOffer: "Enter the minimum offer as a whole number, like 1000.",
        escrowLine: "Add a payment line.",
        marketplaceUrl: "Enter a link that starts with https://.",
        "seo.title": "Add a page title.",
        "seo.description": "Keep this to 200 characters or fewer.",
        "accent.primary": "Use a six-digit hex colour, like #7f9fbf.",
        "accent.contrast": "Use a six-digit hex colour, like #7f9fbf.",
      },
    });
  });

  it("names every missing field of an empty config", () => {
    const result = parseConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      [
        "background",
        "currency",
        "escrowLine",
        "headline",
        "minOffer",
        "sentence",
        "seo.description",
        "seo.title",
        "variant",
        "version",
      ].sort(),
    );
    for (const message of Object.values(result.errors)) expect(message).not.toMatch(/invalid|expected|received/i);
  });

  it.each([null, undefined, "{}", 3, []])("rejects %j as unreadable", (input) => {
    expect(parseConfig(input)).toEqual({ ok: false, errors: { form: "This config can't be read." } });
  });

  it("trims copy and keeps it within its limit", () => {
    const result = parseConfig({ ...defaultConfig(), headline: "  Buy {domain}  " });
    expect(result.ok && result.config.headline).toBe("Buy {domain}");
    expect(errorsFor({ headline: "x".repeat(LIMITS.headline) })).toEqual({});
    expect(errorsFor({ headline: "x".repeat(LIMITS.headline + 1) })).toEqual({
      headline: "Keep this to 60 characters or fewer.",
    });
    expect(errorsFor({ sentence: `{amount}{name}{email}${"x".repeat(LIMITS.sentence)}` })).toEqual({
      sentence: "Keep this to 200 characters or fewer.",
    });
    expect(errorsFor({ escrowLine: "x".repeat(LIMITS.escrowLine + 1) })).toEqual({
      escrowLine: "Keep this to 160 characters or fewer.",
    });
    expect(errorsFor({ seo: { title: "x".repeat(LIMITS.seoTitle + 1), description: "ok" } })).toEqual({
      "seo.title": "Keep this to 70 characters or fewer.",
    });
  });

  it("rejects line breaks in copy", () => {
    expect(errorsFor({ headline: "For\nsale" })).toEqual({ headline: "Keep this on one line." });
  });

  it("allows only the placeholders a field supports", () => {
    expect(errorsFor({ headline: "{domain} for {amount}" })).toEqual({
      headline: "The only placeholder you can use here is {domain}.",
    });
    expect(errorsFor({ sentence: "{price} {amount} {name} {email}" })).toEqual({
      sentence: "The placeholders you can use here are {domain}, {amount}, {name}, {email}.",
    });
    expect(errorsFor({ sentence: "{amount} {amount} {name} {email}" })).toEqual({
      sentence: "Use each of {amount}, {name}, {email} exactly once: they become the form fields.",
    });
    expect(errorsFor({ sentence: "{email}, {name}: {amount}" })).toEqual({});
  });

  it("lets the payment line be empty", () => {
    expect(errorsFor({ escrowLine: "" })).toEqual({});
  });

  it("bounds the minimum offer", () => {
    expect(errorsFor({ minOffer: 0 })).toEqual({});
    expect(errorsFor({ minOffer: LIMITS.minOffer })).toEqual({});
    expect(errorsFor({ minOffer: -1 })).toEqual({ minOffer: "The minimum offer can't be negative." });
    expect(errorsFor({ minOffer: LIMITS.minOffer + 1 })).toEqual({
      minOffer: "The minimum offer can't be more than 100,000,000.",
    });
    expect(errorsFor({ minOffer: "1000" })).toEqual({
      minOffer: "Enter the minimum offer as a whole number, like 1000.",
    });
  });

  it.each([
    "http://example.com",
    "javascript:alert(1)",
    "//example.com",
    "example.com/listing",
    "https://localhost",
    "https://user:pass@example.com",
    "https://",
    `https://example.com/${"x".repeat(LIMITS.marketplaceUrl)}`,
    42,
  ])("rejects the marketplace link %j", (marketplaceUrl) => {
    expect(Object.keys(errorsFor({ marketplaceUrl }))).toEqual(["marketplaceUrl"]);
  });

  it("accepts an https marketplace link and treats an empty one as none", () => {
    const withLink = parseConfig({ ...defaultConfig(), marketplaceUrl: " https://example.com/domain/x?ref=1 " });
    expect(withLink.ok && withLink.config.marketplaceUrl).toBe("https://example.com/domain/x?ref=1");
    for (const empty of ["", null]) {
      const result = parseConfig({ ...defaultConfig(), marketplaceUrl: empty });
      expect(result.ok && result.config.marketplaceUrl).toBeUndefined();
    }
  });

  it("normalises accent colours and accepts a partial override", () => {
    const result = parseConfig({ ...defaultConfig(), accent: { primary: "#7F9FBF" } });
    expect(result.ok && result.config.accent).toEqual({ primary: "#7f9fbf" });
    expect(errorsFor({ accent: "blue" })).toEqual({ accent: "Pick a colour." });
    expect(errorsFor({ accent: { primary: "url(javascript:1)" } })).toEqual({
      "accent.primary": "Use a six-digit hex colour, like #7f9fbf.",
    });
  });

  it("drops unknown keys", () => {
    const result = parseConfig({
      ...defaultConfig(),
      notifyAddress: "owner@example.com",
      seo: { ...defaultConfig().seo, keywords: "x" },
    });
    expect(result).toEqual({ ok: true, config: defaultConfig() });
  });
});
