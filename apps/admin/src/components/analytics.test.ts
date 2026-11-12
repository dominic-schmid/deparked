import { expect, test } from "vitest";
import { formatCompactCount, formatConversion } from "./analytics";

test("conversion is a percentage, none without visits, and capped above 100%", () => {
  expect(formatConversion(1, 10)).toBe("10%");
  expect(formatConversion(1, 3)).toBe("33.3%");
  expect(formatConversion(0, 10)).toBe("0%");
  expect(formatConversion(5, 5)).toBe("100%");
  expect(formatConversion(3, 2)).toBe(">100%");
  expect(formatConversion(1, 0)).toBeNull();
});

test("only big counts are compacted", () => {
  expect(formatCompactCount(99_999)).toBe("99,999");
  expect(formatCompactCount(29_629_630)).toBe("29.6M");
});
