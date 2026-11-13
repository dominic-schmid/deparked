import { describe, expect, it } from "vitest";
import { formatMoneyShort } from "./format";

describe("formatMoneyShort", () => {
  it("drops cents only when there are none", () => {
    expect(formatMoneyShort(850_000, "USD")).toBe("$8,500");
    expect(formatMoneyShort(850_050, "USD")).toBe("$8,500.50");
    expect(formatMoneyShort(1_000, "JPY")).toBe("¥1,000");
    expect(formatMoneyShort(500, "XYZ")).toBe("XYZ\u00a05");
  });
});
