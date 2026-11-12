import { describe, expect, it } from "vitest";
import { RETRY, retryWait } from "./setup-retry";

describe("asking again", () => {
  it("waits between calls and stops after the cap of answers in a row", () => {
    expect(retryWait("working", 1)).toBe(RETRY.working.waitMs);
    expect(RETRY.working.waitMs).toBeGreaterThan(0);
    expect(retryWait("working", RETRY.working.tries)).toBe(RETRY.working.waitMs);
    expect(retryWait("working", RETRY.working.tries + 1)).toBeNull();
    expect(retryWait("busy", 1)).toBe(RETRY.busy.waitMs);
    expect(retryWait("busy", RETRY.busy.tries + 1)).toBeNull();
  });
});
