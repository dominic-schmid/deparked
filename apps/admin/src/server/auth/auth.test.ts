import { bumpSessionVersion, type Db, getWorkspace, hitRateLimit, initWorkspace, setSetupSecret } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  changePassword,
  completeSetup,
  hashSetupSecret,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  login,
  loginRateLimitKey,
  RATE_LIMIT_RETENTION_MS,
  rateLimitSubject,
} from "./account";
import { gate, isSetupPath } from "./gate";
import { securityHeaders } from "./headers";
import { isAllowedOrigin } from "./origin";
import { checkNewPassword, hashPassword, PBKDF2_ITERATIONS, verifyPassword } from "./password";
import {
  clearedSessionCookie,
  clearedSetupSecretCookie,
  httpsRedirect,
  issueSessionToken,
  readSessionToken,
  readSetupSecret,
  SESSION_TTL_MS,
  sessionCookie,
  setupSecretCookie,
  verifySessionToken,
} from "./session";

const KEY = "test-session-key-0123456789abcdef-0123456789";
const OTHER_KEY = "other-session-key-0123456789abcdef-012345678";
const NOW = 1_800_000_000_000;
const SECRET = "setup-secret-with-plenty-of-entropy-4f9a1c";
const PASSWORD = "correct horse battery";
const IP = "203.0.113.7";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored.iterations).toBe(PBKDF2_ITERATIONS);
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}!`, stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD, 1000), hashPassword(PASSWORD, 1000)]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("verifies with the iteration count stored next to the hash", async () => {
    const stored = await hashPassword(PASSWORD, 1000);
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword(PASSWORD, { ...stored, iterations: 1001 })).toBe(false);
  });

  it("treats the same text in another Unicode form as the same password", async () => {
    const stored = await hashPassword("café-passphrase", 1000);
    expect(await verifyPassword("café-passphrase", stored)).toBe(true);
  });

  it("handles very long passwords and rejects absurd ones without hashing", async () => {
    const long = "x".repeat(1024);
    const stored = await hashPassword(long, 1000);
    expect(await verifyPassword(long, stored)).toBe(true);
    expect(await verifyPassword("x".repeat(1025), stored)).toBe(false);
  });

  it("rejects a corrupt stored hash instead of throwing", async () => {
    expect(await verifyPassword(PASSWORD, { hash: "***", salt: "***", iterations: 1000 })).toBe(false);
  });

  it("checks a new password's length and confirmation", () => {
    expect(checkNewPassword("short", "short")).toBe("too_short");
    expect(checkNewPassword("x".repeat(1025), "x".repeat(1025))).toBe("too_long");
    expect(checkNewPassword(PASSWORD, `${PASSWORD} `)).toBe("mismatch");
    expect(checkNewPassword(PASSWORD, PASSWORD)).toBeNull();
  });
});

describe("session token", () => {
  const current = { sessionVersion: 3, now: NOW };

  it("round-trips", async () => {
    const token = await issueSessionToken(KEY, 3, NOW);
    expect(await verifySessionToken(KEY, token, current)).toEqual({
      version: 3,
      issuedAt: NOW,
      expiresAt: NOW + SESSION_TTL_MS,
    });
  });

  it("rejects a token signed with another key", async () => {
    const token = await issueSessionToken(OTHER_KEY, 3, NOW);
    expect(await verifySessionToken(KEY, token, current)).toBeNull();
  });

  it("rejects any tampered field", async () => {
    const token = await issueSessionToken(KEY, 3, NOW);
    const [format, version, issuedAt, expiresAt, signature] = token.split(".");
    const forged = [
      [format, "4", issuedAt, expiresAt, signature],
      [format, version, issuedAt, String(NOW + 10 * SESSION_TTL_MS), signature],
      [format, version, String(NOW + 1), expiresAt, signature],
      [format, version, issuedAt, expiresAt, `${signature?.slice(0, -1)}${signature?.endsWith("A") ? "B" : "A"}`],
      [format, version, issuedAt, expiresAt],
      ["v2", version, issuedAt, expiresAt, signature],
    ];
    for (const parts of forged) {
      expect(await verifySessionToken(KEY, parts.join("."), { sessionVersion: 4, now: NOW })).toBeNull();
      expect(await verifySessionToken(KEY, parts.join("."), current)).toBeNull();
    }
    expect(await verifySessionToken(KEY, "", current)).toBeNull();
    expect(await verifySessionToken(KEY, "garbage", current)).toBeNull();
  });

  it("expires after the fixed lifetime", async () => {
    const token = await issueSessionToken(KEY, 3, NOW);
    expect(await verifySessionToken(KEY, token, { sessionVersion: 3, now: NOW + SESSION_TTL_MS - 1 })).not.toBeNull();
    expect(await verifySessionToken(KEY, token, { sessionVersion: 3, now: NOW + SESSION_TTL_MS })).toBeNull();
  });

  it("dies when the workspace's session version moves on", async () => {
    const token = await issueSessionToken(KEY, 3, NOW);
    expect(await verifySessionToken(KEY, token, { sessionVersion: 4, now: NOW })).toBeNull();
  });

  it("refuses to work without a real key", async () => {
    await expect(issueSessionToken("", 1, NOW)).rejects.toThrow("SESSION_KEY");
    await expect(issueSessionToken("too-short", 1, NOW)).rejects.toThrow("SESSION_KEY");
  });
});

describe("session cookie", () => {
  const workersDev = new URL("https://deparked-admin.example.workers.dev/admin/login");
  const managed = new URL("https://example.com/admin/login");
  const local = new URL("http://localhost:5173/admin/login");

  it("is HttpOnly, Secure, SameSite=Strict, host-only and __Host- prefixed on any real host", () => {
    for (const url of [workersDev, managed, new URL("http://example.com/admin")]) {
      const cookie = sessionCookie(url, "TOKEN");
      expect(cookie).toBe(
        `__Host-deparked_session=TOKEN; Max-Age=${SESSION_TTL_MS / 1000}; Path=/; HttpOnly; Secure; SameSite=Strict`,
      );
      expect(cookie).not.toMatch(/domain/i);
    }
  });

  it("drops Secure only for http on localhost", () => {
    for (const host of ["localhost:5173", "127.0.0.1:8787", "[::1]:8787"]) {
      const cookie = sessionCookie(new URL(`http://${host}/admin`), "TOKEN");
      expect(cookie).toMatch(/^deparked_session=TOKEN; /);
      expect(cookie).not.toMatch(/secure/i);
      expect(cookie).toMatch(/HttpOnly; SameSite=Strict$/);
    }
    expect(sessionCookie(new URL("https://localhost/admin"), "T")).toMatch(/; Secure;/);
    expect(sessionCookie(new URL("http://localhost.example.com/admin"), "T")).toMatch(/; Secure;/);
  });

  it("clears with the same attributes", () => {
    expect(clearedSessionCookie(managed)).toBe(
      "__Host-deparked_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict",
    );
    expect(clearedSessionCookie(local)).toBe("deparked_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict");
  });

  it("reads its own cookie among others, and never the local-dev name on a real host", () => {
    const request = (url: URL, cookie: string) => new Request(url, { headers: { Cookie: cookie } });
    expect(readSessionToken(request(managed, "a=1; __Host-deparked_session=TOKEN; b=2"))).toBe("TOKEN");
    expect(readSessionToken(request(managed, "deparked_session=TOKEN"))).toBeNull();
    expect(readSessionToken(request(local, "deparked_session=TOKEN"))).toBe("TOKEN");
    expect(readSessionToken(new Request(managed))).toBeNull();
  });
});

describe("setup secret cookie", () => {
  const managed = new URL("https://example.com/admin/setup");
  const withCookie = (url: URL, cookie: string) =>
    new Request(url, { headers: { Cookie: cookie.split(";")[0] ?? "" } });

  it("is short-lived, HttpOnly, Secure, SameSite=Strict and host-only", () => {
    expect(setupSecretCookie(managed, "abc-DEF_123")).toBe(
      "__Host-deparked_setup=abc-DEF_123; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Strict",
    );
    expect(clearedSetupSecretCookie(managed)).toMatch(/^__Host-deparked_setup=; Max-Age=0; /);
  });

  it("round-trips any secret without letting it break out of the cookie", () => {
    const secret = 'a b;c=d, e"é/+%';
    const cookie = setupSecretCookie(managed, secret) ?? "";
    expect(cookie.split("; ")[0]).not.toMatch(/[ ;,"]|=.*=/);
    expect(readSetupSecret(withCookie(managed, cookie))).toBe(secret);
  });

  it("refuses an empty or oversized secret and reads nothing when there is no cookie", () => {
    expect(setupSecretCookie(managed, "")).toBeNull();
    expect(setupSecretCookie(managed, "x".repeat(513))).toBeNull();
    expect(readSetupSecret(new Request(managed))).toBeNull();
    expect(readSetupSecret(withCookie(managed, "__Host-deparked_setup=%E0%A4%A"))).toBeNull();
  });
});

describe("https redirect", () => {
  it("sends plain http to the same URL on https", () => {
    expect(httpsRedirect(new URL("http://example.com/admin/login?error=invalid"))).toBe(
      "https://example.com/admin/login?error=invalid",
    );
    expect(httpsRedirect(new URL("http://deparked-admin.example.workers.dev/admin"))).toBe(
      "https://deparked-admin.example.workers.dev/admin",
    );
    expect(httpsRedirect(new URL("http://localhost.example.com/admin"))).toBe("https://localhost.example.com/admin");
  });

  it("leaves https and local dev alone", () => {
    expect(httpsRedirect(new URL("https://example.com/admin"))).toBeNull();
    for (const host of ["localhost:5173", "127.0.0.1:8787", "[::1]:8787"]) {
      expect(httpsRedirect(new URL(`http://${host}/admin`))).toBeNull();
    }
  });
});

describe("rate limit subject", () => {
  it("keeps IPv4 as it is, also when IPv4-mapped", () => {
    expect(rateLimitSubject("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitSubject("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitSubject("::FFFF:203.0.113.7")).toBe("203.0.113.7");
  });

  it("counts IPv6 by its /64, however the address is written", () => {
    const prefix = "2001:db8:1:2::/64";
    for (const ip of [
      "2001:db8:1:2::1",
      "2001:db8:1:2:ffff:ffff:ffff:ffff",
      "2001:0db8:0001:0002:0000:0000:0000:0001",
      "2001:DB8:1:2:a:b:c:d",
    ]) {
      expect(rateLimitSubject(ip)).toBe(prefix);
    }
    expect(rateLimitSubject("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(rateLimitSubject("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitSubject("2001:db8::")).toBe("2001:db8:0:0::/64");
  });

  it("leaves what it cannot parse alone", () => {
    for (const ip of ["local", "", "1::2::3", "2001:db8:zz::1", "1:2:3:4:5:6:7:8:9"]) {
      expect(rateLimitSubject(ip)).toBe(ip);
    }
  });

  it("gives one login counter to a whole /64 and separate ones to neighbours", async () => {
    const key = await loginRateLimitKey(KEY, "2001:db8:1:2::1");
    expect(await loginRateLimitKey(KEY, "2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(key);
    expect(await loginRateLimitKey(KEY, "2001:db8:1:3::1")).not.toBe(key);
  });
});

describe("with a database", () => {
  let db: Db;

  async function seedSecret(expiresAt = NOW + 60_000) {
    await initWorkspace(db, { now: NOW });
    await setSetupSecret(db, { secretHash: await hashSetupSecret(SECRET), expiresAt, now: NOW });
  }

  async function setUp(): Promise<string> {
    await seedSecret();
    const result = await completeSetup(db, { secret: SECRET, password: PASSWORD, sessionKey: KEY, now: NOW });
    if (!result.ok) throw new Error("setup failed");
    return result.token;
  }

  async function sessionOf(token: string, now = NOW) {
    const workspace = await getWorkspace(db);
    return verifySessionToken(KEY, token, { sessionVersion: workspace?.sessionVersion ?? -1, now });
  }

  beforeEach(async () => {
    ({ db } = await createTestDb());
  });

  describe("setup", () => {
    it("sets the password, kills the secret and logs in", async () => {
      const token = await setUp();
      const workspace = await getWorkspace(db);
      expect(workspace?.setupSecretHash).toBeNull();
      expect(workspace?.setupDoneAt).toBe(NOW);
      expect(workspace?.passwordIterations).toBe(PBKDF2_ITERATIONS);
      expect(workspace?.passwordHash).not.toContain(PASSWORD);
      expect(await sessionOf(token)).not.toBeNull();
      expect((await login(db, { password: PASSWORD, ip: IP, sessionKey: KEY, now: NOW })).ok).toBe(true);
    });

    it("cannot be repeated with the same secret", async () => {
      await setUp();
      const again = await completeSetup(db, {
        secret: SECRET,
        password: "another password",
        sessionKey: KEY,
        now: NOW,
      });
      expect(again).toEqual({ ok: false, reason: "invalid_secret" });
      expect((await login(db, { password: "another password", ip: IP, sessionKey: KEY, now: NOW })).ok).toBe(false);
    });

    it("lets exactly one of two concurrent attempts win", async () => {
      await seedSecret();
      const attempt = (password: string) => completeSetup(db, { secret: SECRET, password, sessionKey: KEY, now: NOW });
      const results = await Promise.all([attempt("first password"), attempt("second password")]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      const winner = results[0].ok ? "first password" : "second password";
      const loser = results[0].ok ? "second password" : "first password";
      expect((await login(db, { password: winner, ip: IP, sessionKey: KEY, now: NOW })).ok).toBe(true);
      expect((await login(db, { password: loser, ip: IP, sessionKey: KEY, now: NOW })).ok).toBe(false);
    });

    it("rejects a wrong, expired or missing secret and stores nothing", async () => {
      await seedSecret(NOW + 1000);
      const attempt = (secret: string, now: number) =>
        completeSetup(db, { secret, password: PASSWORD, sessionKey: KEY, now });
      expect((await attempt("wrong", NOW)).ok).toBe(false);
      expect((await attempt("", NOW)).ok).toBe(false);
      expect((await attempt(SECRET, NOW + 1000)).ok).toBe(false);
      expect((await getWorkspace(db))?.passwordHash).toBeNull();
      expect((await attempt(SECRET, NOW + 999)).ok).toBe(true);
    });

    it("fails without a workspace row", async () => {
      const result = await completeSetup(db, { secret: SECRET, password: PASSWORD, sessionKey: KEY, now: NOW });
      expect(result.ok).toBe(false);
    });

    it("as recovery, replaces the password and ends every session", async () => {
      const oldToken = await setUp();
      await setSetupSecret(db, { secretHash: await hashSetupSecret("recovery"), expiresAt: NOW + 1000, now: NOW });
      const result = await completeSetup(db, {
        secret: "recovery",
        password: "brand new one",
        sessionKey: KEY,
        now: NOW,
      });
      expect(result.ok).toBe(true);
      expect(await sessionOf(oldToken)).toBeNull();
      expect((await login(db, { password: PASSWORD, ip: IP, sessionKey: KEY, now: NOW })).ok).toBe(false);
    });
  });

  describe("login", () => {
    it("fails the same way for a wrong password and for a workspace without one", async () => {
      const attempt = () => login(db, { password: "wrong password", ip: IP, sessionKey: KEY, now: NOW });
      expect(await attempt()).toEqual({ ok: false, reason: "invalid" });
      await seedSecret();
      expect(await attempt()).toEqual({ ok: false, reason: "invalid" });
      await completeSetup(db, { secret: SECRET, password: PASSWORD, sessionKey: KEY, now: NOW });
      expect(await attempt()).toEqual({ ok: false, reason: "invalid" });
    });

    it("locks an IP out after too many failures, even with the right password, until the window ends", async () => {
      await setUp();
      const attempt = (password: string, now: number, ip = IP) => login(db, { password, ip, sessionKey: KEY, now });
      for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
        expect(await attempt("wrong password", NOW + i)).toEqual({ ok: false, reason: "invalid" });
      }
      expect(await attempt(PASSWORD, NOW + 10)).toEqual({
        ok: false,
        reason: "locked",
        retryAfterMs: LOGIN_WINDOW_MS - 10,
      });
      expect((await attempt(PASSWORD, NOW + 10, "198.51.100.1")).ok).toBe(true);
      expect((await attempt(PASSWORD, NOW + LOGIN_WINDOW_MS)).ok).toBe(true);
    });

    it("clears the counter on success", async () => {
      await setUp();
      const attempt = (password: string) => login(db, { password, ip: IP, sessionKey: KEY, now: NOW });
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i++) expect((await attempt("wrong password")).ok).toBe(false);
        expect((await attempt(PASSWORD)).ok).toBe(true);
      }
    });

    it("locks out a caller rotating through one IPv6 /64", async () => {
      await setUp();
      for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
        const result = await login(db, {
          password: "wrong password",
          ip: `2001:db8:1:2::${i + 1}`,
          sessionKey: KEY,
          now: NOW,
        });
        expect(result).toEqual({ ok: false, reason: "invalid" });
      }
      const next = await login(db, { password: PASSWORD, ip: "2001:db8:1:2:ffff::9", sessionKey: KEY, now: NOW });
      expect(next).toMatchObject({ reason: "locked" });
    });

    it("deletes stale counters on a failed login and keeps recent ones", async () => {
      const { db: database, sqlite } = await createTestDb();
      await hitRateLimit(database, { key: "offer:stale", windowMs: 1000, now: NOW - RATE_LIMIT_RETENTION_MS - 1 });
      await hitRateLimit(database, { key: "offer:recent", windowMs: 1000, now: NOW - RATE_LIMIT_RETENTION_MS + 1 });
      await login(database, { password: "wrong password", ip: IP, sessionKey: KEY, now: NOW });
      const keys = sqlite
        .prepare("SELECT key FROM rate_limits ORDER BY key")
        .all()
        .map((row) => row.key);
      expect(keys).toEqual([await loginRateLimitKey(KEY, IP), "offer:recent"].sort());
    });

    it("stores only a keyed hash of the IP", async () => {
      const { db: database, sqlite } = await createTestDb();
      await login(database, { password: "wrong password", ip: IP, sessionKey: KEY, now: NOW });
      const rows = sqlite.prepare("SELECT key FROM rate_limits").all();
      expect(rows).toEqual([{ key: await loginRateLimitKey(KEY, IP) }]);
      expect(String(rows[0]?.key)).toMatch(/^login:[0-9a-f]{64}$/);
      expect(await loginRateLimitKey(KEY, IP)).not.toBe(await loginRateLimitKey(OTHER_KEY, IP));
      expect(await loginRateLimitKey(KEY, IP)).not.toBe(await loginRateLimitKey(KEY, "203.0.113.8"));
    });
  });

  describe("log out everywhere", () => {
    it("ends every session without touching the password", async () => {
      const token = await setUp();
      await bumpSessionVersion(db, NOW + 1);
      expect(await sessionOf(token, NOW + 1)).toBeNull();
      const again = await login(db, { password: PASSWORD, ip: IP, sessionKey: KEY, now: NOW + 1 });
      if (!again.ok) throw new Error("login failed");
      expect(await sessionOf(again.token, NOW + 1)).not.toBeNull();
    });
  });

  describe("change password", () => {
    it("needs the current password", async () => {
      await setUp();
      const result = await changePassword(db, {
        currentPassword: "wrong password",
        newPassword: "the next password",
        ip: IP,
        sessionKey: KEY,
        now: NOW,
      });
      expect(result).toEqual({ ok: false, reason: "invalid" });
      expect((await login(db, { password: PASSWORD, ip: IP, sessionKey: KEY, now: NOW })).ok).toBe(true);
    });

    it("ends every other session and keeps the caller logged in", async () => {
      const elsewhere = await setUp();
      const result = await changePassword(db, {
        currentPassword: PASSWORD,
        newPassword: "the next password",
        ip: IP,
        sessionKey: KEY,
        now: NOW + 5,
      });
      if (!result.ok) throw new Error("change failed");
      expect(await sessionOf(elsewhere, NOW + 5)).toBeNull();
      expect(await sessionOf(result.token, NOW + 5)).not.toBeNull();
      expect((await login(db, { password: PASSWORD, ip: IP, sessionKey: KEY, now: NOW + 5 })).ok).toBe(false);
      expect((await login(db, { password: "the next password", ip: IP, sessionKey: KEY, now: NOW + 5 })).ok).toBe(true);
    });

    it("shares the login lockout, so a stolen session cannot guess the password freely", async () => {
      await setUp();
      const attempt = () =>
        changePassword(db, {
          currentPassword: "wrong password",
          newPassword: "x".repeat(12),
          ip: IP,
          sessionKey: KEY,
          now: NOW,
        });
      for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) expect((await attempt()).ok).toBe(false);
      expect(await attempt()).toMatchObject({ reason: "locked" });
    });
  });
});

describe("origin check", () => {
  const request = (method: string, headers: Record<string, string> = {}, url = "https://example.com/admin/login") =>
    new Request(url, { method, headers });

  it("lets safe methods through without headers", () => {
    expect(isAllowedOrigin(request("GET"))).toBe(true);
    expect(isAllowedOrigin(request("HEAD"))).toBe(true);
  });

  it("accepts a state-changing request from its own origin", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isAllowedOrigin(request(method, { Origin: "https://example.com" }))).toBe(true);
    }
    expect(
      isAllowedOrigin(request("POST", { Origin: "http://localhost:5173" }, "http://localhost:5173/admin/login")),
    ).toBe(true);
  });

  it("rejects another site, a sibling host, another scheme or port, and a missing origin", () => {
    const rejected = [
      { Origin: "https://evil.example" },
      { Origin: "https://www.example.com" },
      { Origin: "https://example.com.evil.example" },
      { Origin: "http://example.com" },
      { Origin: "https://example.com:8443" },
      { Origin: "null" },
      { Origin: "null", Referer: "https://example.com/admin" },
      {},
    ];
    for (const headers of rejected) expect(isAllowedOrigin(request("POST", headers))).toBe(false);
  });

  it("falls back to Referer only when Origin is absent", () => {
    expect(isAllowedOrigin(request("POST", { Referer: "https://example.com/admin/login?x=1" }))).toBe(true);
    expect(isAllowedOrigin(request("POST", { Referer: "https://evil.example/https://example.com/" }))).toBe(false);
    expect(isAllowedOrigin(request("POST", { Origin: "https://evil.example", Referer: "https://example.com/" }))).toBe(
      false,
    );
  });
});

describe("security headers", () => {
  const headers = securityHeaders({ nonce: "N0NCE", dev: false });
  const csp = headers["Content-Security-Policy"] ?? "";

  it("sets the fixed headers", () => {
    expect(headers).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
    });
  });

  it("allows scripts only from self and this response's nonce", () => {
    expect(csp).toContain("script-src 'self' 'nonce-N0NCE'");
    expect(csp.split("; ").find((directive) => directive.startsWith("script-src"))).not.toMatch(/unsafe|https?:|\*/);
    expect(csp).toContain("default-src 'none'");
  });

  it("forbids framing the admin and allows only same-origin frames inside it", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("challenges.cloudflare.com");
  });

  it("opens the HMR websocket in dev only", () => {
    expect(csp).toContain("connect-src 'self';");
    expect(securityHeaders({ nonce: "N", dev: true })["Content-Security-Policy"]).toContain("connect-src 'self' ws:");
  });
});

describe("gate", () => {
  const base = { isServerFn: false, hasPassword: true, setupPending: false, hasSession: false };
  const next = { type: "next" };
  const to = (path: string) => ({ type: "redirect", to: path });

  it("sends anonymous visitors to login, whatever the spelling of the path", () => {
    for (const pathname of [
      "/admin",
      "/admin/",
      "/admin/settings/password",
      "/ADMIN",
      "/%61dmin",
      "/admin/logout",
      "/x",
      "/admin/%",
    ]) {
      expect(gate({ ...base, pathname })).toEqual(to("/admin/login"));
    }
  });

  it("sends them to setup instead while a first-run secret is pending", () => {
    const fresh = { ...base, hasPassword: false, setupPending: true };
    expect(gate({ ...fresh, pathname: "/admin" })).toEqual(to("/admin/setup"));
    expect(gate({ ...fresh, pathname: "/admin/login" })).toEqual(to("/admin/setup"));
    expect(gate({ ...fresh, pathname: "/admin/setup" })).toEqual(next);
    expect(gate({ ...base, hasPassword: false, pathname: "/admin" })).toEqual(to("/admin/login"));
  });

  it("recognises the setup path in any spelling", () => {
    for (const pathname of ["/admin/setup", "/admin/setup/", "/Admin/Setup", "/admin/%73etup"]) {
      expect(isSetupPath(pathname)).toBe(true);
    }
    expect(isSetupPath("/admin/setup/done")).toBe(false);
    expect(isSetupPath("/admin/login")).toBe(false);
  });

  it("opens login and setup without a session", () => {
    expect(gate({ ...base, pathname: "/admin/login" })).toEqual(next);
    expect(gate({ ...base, pathname: "/Admin/Login/" })).toEqual(next);
    expect(gate({ ...base, pathname: "/" })).toEqual(next);
  });

  it("says setup is done once the secret is dead, and reopens setup for a recovery secret", () => {
    expect(gate({ ...base, pathname: "/admin/setup" })).toEqual(to("/admin/setup/done"));
    expect(gate({ ...base, pathname: "/admin/setup/done" })).toEqual(next);
    expect(gate({ ...base, setupPending: true, pathname: "/admin/setup" })).toEqual(next);
    expect(gate({ ...base, setupPending: true, pathname: "/admin/setup/done" })).toEqual(to("/admin/setup"));
    expect(gate({ ...base, hasPassword: false, pathname: "/admin/setup/done" })).toEqual(to("/admin/setup"));
  });

  it("lets a session in and keeps it off the login screen", () => {
    const loggedIn = { ...base, hasSession: true };
    expect(gate({ ...loggedIn, pathname: "/admin" })).toEqual(next);
    expect(gate({ ...loggedIn, pathname: "/admin/settings/password" })).toEqual(next);
    expect(gate({ ...loggedIn, pathname: "/admin/login" })).toEqual(to("/admin"));
  });

  it("answers server functions with 401 instead of a redirect, with no public exceptions", () => {
    expect(gate({ ...base, isServerFn: true, pathname: "/admin/_serverFn/abc" })).toEqual({ type: "unauthorized" });
    expect(gate({ ...base, isServerFn: true, pathname: "/admin/login" })).toEqual({ type: "unauthorized" });
    expect(gate({ ...base, isServerFn: true, hasSession: true, pathname: "/admin/_serverFn/abc" })).toEqual(next);
  });
});
