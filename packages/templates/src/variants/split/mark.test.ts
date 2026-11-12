import { describe, expect, it } from "vitest";
import { fitMark } from "./mark";

describe("Split's fitMark", () => {
  it("sets a domain on one line across the panel", () => {
    const fit = fitMark("example.com");
    expect(fit.lines).toEqual(["example.com"]);
    expect(fit.fontSizeCqi).toBeGreaterThan(15);
    expect(fit.fontSizeCqi).toBeLessThanOrEqual(30);
  });

  it("caps a short name", () => {
    expect(fitMark("x.io")).toEqual({ fontSizeCqi: 30, lines: ["x.io"] });
  });

  it("sets a long name on even lines, broken where a reader expects", () => {
    const host = "the-international-association-of-very-long-domain-names.example";
    const fit = fitMark(host);
    expect(fit.lines?.length).toBeGreaterThan(1);
    expect(fit.lines?.join("")).toBe(host);
    for (const line of fit.lines?.slice(0, -1) ?? []) expect(line).toMatch(/-$/);
  });
});
