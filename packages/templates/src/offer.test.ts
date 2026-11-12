import { describe, expect, it } from "vitest";
import { editAmount, minOfferMessage } from "./offer";

/** Types `value` with the caret at `|`, as the browser leaves it after the edit. */
function edit(value: string, previous: string, how = "insertText") {
  const caret = value.indexOf("|");
  const result = editAmount(value.replace("|", ""), caret, previous, how);
  return `${result.value.slice(0, result.caret)}|${result.value.slice(result.caret)}`;
}

describe("editAmount", () => {
  it("groups thousands as the digits are typed, the caret staying at the end", () => {
    expect(edit("1|", "")).toBe("1|");
    expect(edit("1500|", "150")).toBe("1,500|");
    expect(edit("1,5000|", "1,500")).toBe("15,000|");
  });

  it("keeps the caret after the digit it followed when typing in the middle", () => {
    // 1,5|00 → typing 9 → 15,9|00
    expect(edit("1,59|00", "1,500")).toBe("15,9|00");
    // |1,500 → typing 2 at the start
    expect(edit("2|1,500", "1,500")).toBe("2|1,500");
  });

  it("deletes the digit before a comma when Backspace lands on the comma", () => {
    expect(edit("1|500", "1,500", "deleteContentBackward")).toBe("|500");
    expect(edit("12,|00", "12,500", "deleteContentBackward")).toBe("1,2|00");
  });

  it("deletes the digit after a comma when Delete lands on the comma", () => {
    expect(edit("1|500", "1,500", "deleteContentForward")).toBe("1|00");
  });

  it("drops everything but digits, leading zeros and digits past the limit", () => {
    expect(edit("€ 2.000|", "")).toBe("2,000|");
    expect(edit("007|", "00")).toBe("7|");
    expect(edit("1234567890|", "123456789")).toBe("123,456,789|");
    expect(edit("abc|", "")).toBe("|");
  });

  it("drops the cents of a pasted price", () => {
    expect(edit("1,500.00|", "", "insertFromPaste")).toBe("1,500|");
    expect(edit("1.500,50|", "", "insertFromPaste")).toBe("1,500|");
    expect(edit("€ 2500|", "", "insertFromPaste")).toBe("2,500|");
  });

  it("does not take a typed group for cents", () => {
    expect(edit("1,50|", "1,500", "deleteContentBackward")).toBe("150|");
  });
});

describe("minOfferMessage", () => {
  it("names the formatted minimum and what to do", () => {
    expect(minOfferMessage(1000, "EUR")).toBe("Offers start at €1,000. Raise yours to send it");
    expect(minOfferMessage(2500000, "CHF")).toBe("Offers start at CHF\u00a02,500,000. Raise yours to send it");
  });
});
