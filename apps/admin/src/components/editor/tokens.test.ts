import { describe, expect, it } from "vitest";
import { insertToken, tokenCount } from "./tokens";

describe("fill-in words", () => {
  it("counts each word on its own", () => {
    const text = "Buy {domain} for {amount}. {name}, {name}";
    expect(tokenCount(text, "amount")).toBe(1);
    expect(tokenCount(text, "name")).toBe(2);
    expect(tokenCount(text, "email")).toBe(0);
  });

  it("puts a word in at the caret, apart from the word before it, with the caret after it", () => {
    expect(insertToken("Reach me at ", "email", 12, 12)).toEqual({ text: "Reach me at {email}", caret: 19 });
    expect(insertToken("Reach me at.", "email", 11, 11)).toEqual({ text: "Reach me at {email}.", caret: 19 });
    expect(insertToken("", "domain", 0, 0)).toEqual({ text: "{domain}", caret: 8 });
  });

  it("replaces a selection", () => {
    expect(insertToken("Buy THIS now", "domain", 4, 8)).toEqual({ text: "Buy {domain} now", caret: 12 });
  });
});
