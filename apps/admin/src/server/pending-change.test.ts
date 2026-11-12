import { describe, expect, test } from "vitest";
import { pendingChange } from "./pending-change";

const T = 1_000;
const created = (at: number) => ({ createdAt: at, undoneAt: null });
const undone = (at: number, undoneAt: number) => ({ createdAt: at, undoneAt });

describe("a change that stopped half-way", () => {
  test("a domain on, or cleanly off, has none", () => {
    expect(pendingChange({ status: "live", turnedOffAt: null, ledger: [created(T)], hasPages: true })).toBeNull();
    expect(pendingChange({ status: "off", turnedOffAt: T, ledger: [undone(T, T + 5)], hasPages: false })).toBeNull();
    // Turned off, then on again: the old undone entries are older than the new ones.
    expect(
      pendingChange({
        status: "placeholder",
        turnedOffAt: null,
        ledger: [undone(T, T + 5), created(T + 9)],
        hasPages: true,
      }),
    ).toBeNull();
  });

  test("off with settings being created: adding, or turning on again after a turn off", () => {
    expect(pendingChange({ status: "off", turnedOffAt: null, ledger: [created(T)], hasPages: false })).toBe("adding");
    expect(
      pendingChange({ status: "off", turnedOffAt: T + 5, ledger: [undone(T, T + 5), created(T + 9)], hasPages: true }),
    ).toBe("turning-on");
  });

  test("settings being removed, or only the pages left: turning off", () => {
    expect(
      pendingChange({ status: "live", turnedOffAt: null, ledger: [created(T), undone(T + 1, T + 9)], hasPages: true }),
    ).toBe("turning-off");
    expect(pendingChange({ status: "off", turnedOffAt: T, ledger: [undone(T, T + 5)], hasPages: true })).toBe(
      "turning-off",
    );
    // A half-added domain that a turn off then started to undo.
    expect(
      pendingChange({ status: "off", turnedOffAt: null, ledger: [created(T), undone(T + 1, T + 9)], hasPages: false }),
    ).toBe("turning-off");
  });

  test("when both moved at the same moment the data cannot tell", () => {
    expect(
      pendingChange({ status: "off", turnedOffAt: null, ledger: [created(T + 9), undone(T, T + 9)], hasPages: false }),
    ).toBe("unclear");
  });
});
