import { describe, expect, it } from "vitest";
import { contrastOn, contrastRatio, luminance, READABLE, readableOn } from "./contrast";

// Every 17th step of each channel: 4,096 colours from black to white, pale, mid and dark among them.
const COLOURS = Array.from({ length: 16 ** 3 }, (_, index) => {
  const hex = (value: number) => (value * 17).toString(16).padStart(2, "0");
  return `#${hex(index >> 8)}${hex((index >> 4) & 15)}${hex(index & 15)}`;
});
const PALETTES = [
  { ink: "#1d2614", paper: "#ffffff" },
  { ink: "#1a1714", paper: "#f4efe6" },
  { ink: "#121211", paper: "#f4f4f1" },
  { ink: "#1f2918", paper: "#f2ede1" },
];

describe("contrastRatio", () => {
  it("matches WCAG's reference values", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBe(1);
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#7f9fbf", "#7f9fbf")).toBe(1);
  });
});

describe("contrastOn", () => {
  it("puts ink on a pale accent and paper on a dark one", () => {
    const palette = { ink: "#1a1714", paper: "#f4efe6" };
    expect(contrastOn("#fff3b0", palette)).toBe("#1a1714");
    expect(contrastOn("#e0a020", palette)).toBe("#1a1714");
    expect(contrastOn("#1d3557", palette)).toBe("#f4efe6");
  });

  it("falls back to black or white for a mid-tone accent neither of the design's colours reads on", () => {
    const palette = { ink: "#3a3a3a", paper: "#d0d0d0" };
    expect(contrastOn("#808080", palette)).toBe("#000000");
  });

  it.each(PALETTES)("reads at 4.5:1 on every accent (%o)", (palette) => {
    for (const accent of COLOURS) {
      expect(contrastRatio(contrastOn(accent, palette), accent), accent).toBeGreaterThanOrEqual(READABLE);
    }
  });
});

describe("readableOn", () => {
  it("keeps a colour that already reads", () => {
    expect(readableOn("#b3301a", "#f4efe6")).toBe("#b3301a");
  });

  it("darkens a pale colour on paper and lightens a dark one on ink, keeping its hue", () => {
    const onPaper = readableOn("#ffd166", "#f4efe6");
    expect(contrastRatio(onPaper, "#f4efe6")).toBeGreaterThanOrEqual(READABLE);
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(onPaper.slice(at, at + 2), 16)) as number[];
    expect(r).toBeGreaterThan(g as number);
    expect(g).toBeGreaterThan(b as number);
    expect(contrastRatio(readableOn("#1d3557", "#15130f"), "#15130f")).toBeGreaterThanOrEqual(READABLE);
  });

  it.each(["#f4efe6", "#15130f", "#f4f4f1", "#0f0f0e"])("always reaches 4.5:1 on %s", (background) => {
    for (const color of COLOURS) {
      expect(contrastRatio(readableOn(color, background), background), color).toBeGreaterThanOrEqual(READABLE);
    }
  });
});
