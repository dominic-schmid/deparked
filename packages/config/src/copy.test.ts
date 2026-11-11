import { describe, expect, it } from "vitest";
import { defaultConfig, fillDomain, sentenceParts } from "./index";

describe("fillDomain", () => {
  it("fills every {domain} with the host", () => {
    expect(fillDomain("{domain} is for sale. Buy {domain}.", "example.com")).toBe(
      "example.com is for sale. Buy example.com.",
    );
    expect(fillDomain(defaultConfig().seo.title, "example.com")).toBe("example.com is for sale");
  });
});

describe("sentenceParts", () => {
  it("splits the default sentence into text and form slots", () => {
    expect(sentenceParts(defaultConfig().sentence, "example.com")).toEqual([
      { type: "text", text: "I'd like to buy example.com for " },
      { type: "slot", slot: "amount" },
      { type: "text", text: ". My name is " },
      { type: "slot", slot: "name" },
      { type: "text", text: " and you can reach me at " },
      { type: "slot", slot: "email" },
      { type: "text", text: "." },
    ]);
  });

  it("leaves out empty text between adjacent slots", () => {
    expect(sentenceParts("{email}{name} {amount}", "example.com")).toEqual([
      { type: "slot", slot: "email" },
      { type: "slot", slot: "name" },
      { type: "text", text: " " },
      { type: "slot", slot: "amount" },
    ]);
  });
});
