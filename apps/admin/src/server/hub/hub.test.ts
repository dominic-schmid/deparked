import { describe, expect, it } from "vitest";
import { TOKEN_CHECK_TTL_MS, type TokenCache, tokenRejected, tokenSchema, uninstallConfirmationSchema } from "./hub";

describe("the pasted token", () => {
  it("takes a Cloudflare-shaped token and trims it", () => {
    const token = "a".repeat(20) + "-_B9".repeat(5);
    expect(tokenSchema.parse({ token: ` ${token}\n` })).toEqual({ token });
  });

  it("refuses a fragment, spaces inside and anything that is not a token", () => {
    for (const token of [
      "short",
      `${"a".repeat(20)} ${"b".repeat(20)}`,
      "Bearer abc".padEnd(40, "x"),
      "x".repeat(300),
    ]) {
      expect(tokenSchema.safeParse({ token }).success, token).toBe(false);
    }
  });
});

describe("the uninstall confirmation", () => {
  it("needs the exact words, in any case", () => {
    expect(uninstallConfirmationSchema.safeParse(" Uninstall Deparked ").success).toBe(true);
    expect(uninstallConfirmationSchema.safeParse("uninstall").success).toBe(false);
  });
});

describe("the token banner", () => {
  it("asks once per interval and remembers the answer", async () => {
    const cache: { current: TokenCache } = { current: null };
    let asked = 0;
    let accepted = false;
    const hub = () => ({
      tokenAccepted: async () => {
        asked += 1;
        return accepted;
      },
    });
    expect(await tokenRejected(cache, hub, 1000)).toBe(true);
    accepted = true;
    expect(await tokenRejected(cache, hub, 1000 + TOKEN_CHECK_TTL_MS - 1)).toBe(true);
    expect(asked).toBe(1);
    expect(await tokenRejected(cache, hub, 1000 + TOKEN_CHECK_TTL_MS)).toBe(false);
    expect(asked).toBe(2);
  });

  it("shows nothing and remembers nothing when the host cannot be asked", async () => {
    const cache: { current: TokenCache } = { current: null };
    const failing = () => ({
      tokenAccepted: async (): Promise<boolean> => {
        throw new Error("unreachable");
      },
    });
    expect(await tokenRejected(cache, failing, 1)).toBe(false);
    expect(cache.current).toBeNull();
  });
});
