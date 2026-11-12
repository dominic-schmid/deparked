import { describe, expect, it } from "vitest";
import { hostingConnection, loopbackOverride } from "./hosting-env";

describe("endpoint overrides", () => {
  it.each(["http://127.0.0.1:8787/client/v4", "http://localhost:4010/turnstile/v0/siteverify"])(
    "accepts the loopback address %s",
    (url) => {
      expect(loopbackOverride(url)).toBe(url);
    },
  );

  it.each([
    "https://evil.example/client/v4",
    "http://evil.example:8787/client/v4",
    "https://127.0.0.1:8787/",
    "http://127.0.0.1/client/v4",
    "http://localhost/",
    "http://localhost.evil.example:8787/",
    "http://127.0.0.1.evil.example:8787/",
    "http://user:pass@127.0.0.1:8787/",
    "http://127.0.0.1:8787@evil.example/",
    "http://[::1]:8787/",
    "http://0.0.0.0:8787/",
    "//127.0.0.1:8787/",
    "not a url",
    "",
  ])("ignores %j", (url) => {
    expect(loopbackOverride(url)).toBeUndefined();
  });

  it("falls back to Cloudflare's endpoints when an override is not loopback", () => {
    const connection = hostingConnection({
      CF_API_TOKEN: "token",
      CF_ACCOUNT_ID: "account",
      CLOUDFLARE_API_BASE: "https://evil.example/client/v4",
      TURNSTILE_VERIFY_URL: "https://evil.example/siteverify",
    });
    expect(connection).not.toHaveProperty("baseUrl");
    expect(connection).not.toHaveProperty("botCheckUrl");
    expect(connection).toMatchObject({ token: "token", accountId: "account" });
  });

  it("passes loopback overrides on, prefers the workspace's account and reads secrets by name", () => {
    const connection = hostingConnection(
      {
        CF_ACCOUNT_ID: "from-env",
        CLOUDFLARE_API_BASE: "http://127.0.0.1:8787/client/v4",
        TURNSTILE_VERIFY_URL: "http://127.0.0.1:8787/turnstile/v0/siteverify",
        TURNSTILE_SECRET_1: "secret",
        DB: {},
      },
      "from-workspace",
    );
    expect(connection).toMatchObject({
      accountId: "from-workspace",
      baseUrl: "http://127.0.0.1:8787/client/v4",
      botCheckUrl: "http://127.0.0.1:8787/turnstile/v0/siteverify",
    });
    expect(connection.getSecret("TURNSTILE_SECRET_1")).toBe("secret");
    expect(connection.getSecret("TURNSTILE_SECRET_2")).toBeUndefined();
    expect(connection.getSecret("DB")).toBeUndefined();
  });
});
