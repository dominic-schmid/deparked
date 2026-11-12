import { describe, expect, it } from "vitest";
import { fitMark } from "./mark";

describe("Mono's fitMark", () => {
  it("fits the headline with room for the caret, which is not part of the text", () => {
    const fit = fitMark("example.com");
    expect(fit.lines).toEqual(["example.com"]);
    // 12 glyphs of 0.56em span 99cqi
    expect(fit.fontSizeCqi).toBe(14.73);
  });

  it("caps a short name", () => {
    expect(fitMark("x.io")).toEqual({ fontSizeCqi: 30, lines: ["x.io"] });
  });

  it("sets a long name on even lines and keeps every character", () => {
    const host = "the-international-association-of-very-long-domain-names.example";
    const fit = fitMark(host);
    expect(fit.lines?.length).toBeGreaterThan(1);
    expect(fit.lines?.join("")).toBe(host);
  });

  it("leaves text it cannot measure to the browser", () => {
    expect(fitMark("هذا النطاق المميز").lines).toBeNull();
  });
});
