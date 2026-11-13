import { describe, expect, test } from "vitest";
import { filteredEmptyTitle, offerContextLine, ordinal, STATUS_ACTIONS } from "./offer-copy";

describe("offer copy", () => {
  test.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [102, "102nd"],
    [111, "111th"],
  ])("%i is the %s", (value, text) => expect(ordinal(value)).toBe(text));

  const offer = { amountMinor: 250_000, currency: "USD" };
  const context = { ordinal: 3, total: 5, bestAmountMinor: 850_000, bestCurrency: "USD" };

  test("the context line says where the offer stands", () => {
    expect(offerContextLine({ ...offer, context })).toBe("3rd of 5 offers on this domain, best is $8,500");
    expect(offerContextLine({ ...offer, context: { ...context, bestAmountMinor: 250_000 } })).toBe(
      "3rd of 5 offers on this domain, and the best",
    );
    expect(offerContextLine({ ...offer, context: { ...context, ordinal: 1, total: 1 } })).toBe(
      "The first offer on this domain",
    );
    // Another currency's best is quoted in its own currency, not converted.
    expect(offerContextLine({ ...offer, context: { ...context, bestAmountMinor: 250_000, bestCurrency: "EUR" } })).toBe(
      "3rd of 5 offers on this domain, best is €2,500",
    );
    expect(offerContextLine({ ...offer, context: null })).toBeNull();
  });

  test("every status can be undone", () => {
    for (const [status, actions] of Object.entries(STATUS_ACTIONS)) {
      expect(actions.map((action) => action.status)).not.toContain(status);
      expect(actions).toHaveLength(2);
    }
  });

  test("an empty filter names what it filters", () => {
    expect(filteredEmptyTitle({ status: "new" })).toBe("No new offers");
    expect(filteredEmptyTitle({ host: "example.com" })).toBe("No offers for example.com");
    expect(filteredEmptyTitle({ status: "ignored", host: "example.com" })).toBe("No ignored offers for example.com");
  });
});
