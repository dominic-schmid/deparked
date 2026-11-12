import { describe, expect, it } from "vitest";
import { fitMark } from "./mark";

describe("fitMark", () => {
  it("sets wrappr.app exactly as the original did", () => {
    expect(fitMark("wrappr.app")).toEqual({ fontSizeCqi: 27, lines: ["wrappr.app"] });
  });

  it("shrinks a longer name to stay on one line", () => {
    const fit = fitMark("a-longer-example.com");
    expect(fit.lines).toEqual(["a-longer-example.com"]);
    expect(fit.fontSizeCqi).toBeLessThan(27);
  });

  it("caps a short name instead of filling the width", () => {
    expect(fitMark("x.io")).toEqual({ fontSizeCqi: 42, lines: ["x.io"] });
  });

  it("sets a long name on even lines, broken where a reader expects", () => {
    expect(fitMark("northwind-industries.example").lines).toEqual(["northwind-", "industries.example"]);
    expect(fitMark("the-international-association-of-very-long-domain-names.example").lines).toEqual([
      "the-international-",
      "association-of-very-long-",
      "domain-names.example",
    ]);
    expect(fitMark("The Northwind Industries Holdings portfolio").lines).toEqual([
      "The Northwind Industries ",
      "Holdings portfolio",
    ]);
  });

  it("breaks anywhere when a name has no good place to break", () => {
    const { lines } = fitMark(`${"w".repeat(40)}.com`);
    expect(lines?.length).toBeGreaterThan(1);
    expect(lines?.join("")).toBe(`${"w".repeat(40)}.com`);
    expect(
      Math.max(...(lines ?? []).map((line) => line.length)) - Math.min(...(lines ?? []).map((line) => line.length)),
    ).toBeLessThan(6);
  });

  it("never loses a character", () => {
    for (const headline of [
      "a b c d e f g h i j k l m n o p q r s t u v w x y z a b c",
      "one-two.three four-five.six seven-eight.nine",
    ]) {
      expect(fitMark(headline).lines?.join("")).toBe(headline);
    }
  });

  it("leaves a headline it cannot measure to the browser", () => {
    expect(fitMark("نطاق للبيع").lines).toBeNull();
    expect(fitMark("Zürich.example").lines).toBeNull();
  });
});
