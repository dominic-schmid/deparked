import { defaultConfig } from "@deparked/config";
import {
  type Db,
  insertDomain,
  insertNotifyAddress,
  insertTurnstileWidget,
  listOffers,
  publishConfig,
  setDomainStatus,
  updateNotifyAddress,
} from "@deparked/db";
import { createTestDb, type ExecutedStatement } from "@deparked/db/testing";
import { HostingError } from "@deparked/hosting";
import { createFakeHosting } from "@deparked/hosting/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleOffer, MAX_BODY_BYTES } from "./http";
import { OFFER_BURST, OFFER_SUSTAINED } from "./submit";

const NOW = 1_800_000_000_000;
const HOST = "example.com";
const NOTIFY = "owner@example.com";
const SESSION_KEY = "test-session-key-0123456789abcdef0123";
const MIN_OFFER = 500;

type Hosting = ReturnType<typeof createFakeHosting>;

let db: Db;
let executed: ExecutedStatement[];
let hosting: Hosting;
let now: number;
let tokens = 0;

async function addDomain(host: string, status: "live" | "placeholder" | "off" | "removed" = "live"): Promise<void> {
  await insertDomain(db, {
    domain: { host, zoneId: `zone-${host}`, turnstileWidgetId: "1x00000000000000000000AA", notifyEmail: NOTIFY },
    now: NOW,
  });
  await goLive(host, status);
}

async function goLive(host: string, status: "live" | "placeholder" | "off" | "removed" = "live"): Promise<void> {
  const json = JSON.stringify({ ...defaultConfig(), currency: "EUR", minOffer: MIN_OFFER });
  await publishConfig(db, { host, json, schemaVersion: 1, release: "test", now: NOW });
  await setDomainStatus(db, { host, status, now: NOW });
}

function token(host = HOST): string {
  const value = `token-${++tokens}`;
  hosting.acceptBotToken(value, host);
  return value;
}

type Fields = Record<string, unknown>;

function offer(overrides: Fields = {}): Fields {
  return {
    amount: 1500,
    name: "Jane Buyer",
    email: "jane@buyer.example",
    website: "",
    "cf-turnstile-response": token(),
    ...overrides,
  };
}

function send(init: { body?: string; headers?: Record<string, string>; method?: string; host?: string }) {
  const request = new Request(`https://${init.host ?? HOST}/api/offer`, {
    method: init.method ?? "POST",
    headers: { "CF-Connecting-IP": "203.0.113.7", "CF-IPCountry": "AT", ...init.headers },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  return handleOffer(request, { db, hosting, sessionKey: SESSION_KEY, now });
}

function postJson(fields: Fields, extra: { host?: string; headers?: Record<string, string> } = {}) {
  return send({
    body: JSON.stringify(fields),
    headers: { "content-type": "application/json", ...extra.headers },
    ...(extra.host === undefined ? {} : { host: extra.host }),
  });
}

function postForm(fields: Fields, extra: { host?: string } = {}) {
  const body = new URLSearchParams(Object.entries(fields).map(([key, value]) => [key, String(value)])).toString();
  return send({ body, headers: { "content-type": "application/x-www-form-urlencoded" }, ...extra });
}

async function stored() {
  return (await listOffers(db)).offers;
}

/** What the requests ran, without this file's own reads of the offers table. */
function requestStatements(): ExecutedStatement[] {
  return executed.filter((statement) => !statement.sql.startsWith('select "id", "host", "amount_minor"'));
}

async function expectRefused(response: Response, status: number, code: string, field?: string) {
  expect(response.status).toBe(status);
  const body = (await response.json()) as Fields;
  expect(body).toMatchObject({ ok: false, code, ...(field === undefined ? {} : { field }) });
  expect(typeof body.error).toBe("string");
  if (field === undefined) expect(body).not.toHaveProperty("field");
  expect(await stored()).toEqual([]);
  expect(hosting.sent).toEqual([]);
}

beforeEach(async () => {
  ({ db, executed } = await createTestDb());
  hosting = createFakeHosting({ verifiedAddresses: [NOTIFY] });
  now = NOW;
  await insertNotifyAddress(db, { email: NOTIFY, verifiedAt: NOW, now: NOW });
  await insertTurnstileWidget(db, {
    sitekey: "1x00000000000000000000AA",
    name: "deparked-1",
    secretName: "TURNSTILE_SECRET_1",
    now: NOW,
  });
  await addDomain(HOST);
  executed.length = 0;
});

describe("POST /api/offer", () => {
  it("stores the offer and emails the owner", async () => {
    const response = await postJson(offer({ message: "Is the price negotiable?\r\nThanks" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();

    expect(await stored()).toMatchObject([
      {
        host: HOST,
        amountMinor: 150_000,
        currency: "EUR",
        name: "Jane Buyer",
        email: "jane@buyer.example",
        country: "AT",
        message: "Is the price negotiable?\nThanks",
        status: "new",
        emailStatus: "sent",
        emailError: null,
        notifiedTo: NOTIFY,
      },
    ]);
    expect(hosting.sent).toHaveLength(1);
    expect(hosting.sent[0]).toMatchObject({
      senderHost: HOST,
      to: NOTIFY,
      replyTo: { email: "jane@buyer.example", name: "Jane Buyer" },
      subject: "Offer for example.com: 1,500 EUR",
    });
    expect(hosting.sent[0]?.text).toContain("Is the price negotiable?\nThanks");
  });

  it("stores the offer before it sends the email", async () => {
    const sendNotification = vi.spyOn(hosting, "sendNotification").mockImplementation(async () => {
      expect(await stored()).toMatchObject([{ emailStatus: "pending", notifiedTo: null }]);
    });
    expect((await postJson(offer())).status).toBe(200);
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(await stored()).toMatchObject([{ emailStatus: "sent" }]);
  });

  it("keeps and flags the offer when the email fails, and still tells the buyer it worked", async () => {
    hosting.failNext("sendNotification", new HostingError("failed", "Cloudflare did not accept the email."));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await postJson(offer());
    expect(await response.json()).toEqual({ ok: true });
    expect(await stored()).toMatchObject([
      { emailStatus: "failed", emailError: "Cloudflare did not accept the email.", notifiedTo: null },
    ]);
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).toBe('[["offer: email-failed"]]');
    errors.mockRestore();
  });

  it("does not quote an unexpected email error", async () => {
    hosting.failNext("sendNotification", new Error("550 rejected jane@buyer.example"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await postJson(offer())).status).toBe(200);
    expect(await stored()).toMatchObject([{ emailStatus: "failed", emailError: "The email could not be sent." }]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("jane");
    errors.mockRestore();
  });

  it("keeps the offer when the notify address is not verified, or not set", async () => {
    await updateNotifyAddress(db, { email: NOTIFY, patch: { verifiedAt: null } });
    expect((await postJson(offer())).status).toBe(200);
    expect(hosting.sent).toEqual([]);
    expect(await stored()).toMatchObject([
      { emailStatus: "failed", emailError: "The address for offers is not verified yet.", notifiedTo: null },
    ]);

    await insertDomain(db, { domain: { host: "second.example", zoneId: "zone-2" }, now: NOW });
    await goLive("second.example");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    hosting.acceptBotToken("second", "second.example");
    const noWidget = await postJson(offer({ "cf-turnstile-response": "second" }), { host: "second.example" });
    expect(noWidget.status).toBe(503);
    errors.mockRestore();

    await insertDomain(db, {
      domain: { host: "third.example", zoneId: "zone-3", turnstileWidgetId: "1x00000000000000000000AA" },
      now: NOW,
    });
    await goLive("third.example");
    expect(
      (await postJson(offer({ "cf-turnstile-response": token("third.example") }), { host: "third.example" })).status,
    ).toBe(200);
    expect((await listOffers(db, { host: "third.example" })).offers).toMatchObject([
      { emailStatus: "failed", emailError: "This domain has no address for offers yet.", notifiedTo: null },
    ]);
  });

  it("refuses a host that is not managed, without touching anything", async () => {
    hosting.acceptBotToken("elsewhere", "unknown.example");
    const response = await postJson(offer({ "cf-turnstile-response": "elsewhere" }), { host: "unknown.example" });
    await expectRefused(response, 404, "not-for-sale");
    expect(executed.every((statement) => /^select/i.test(statement.sql))).toBe(true);
  });

  it("never takes offers on www", async () => {
    await addDomain("www.example.com");
    hosting.acceptBotToken("www", "www.example.com");
    const response = await postJson(offer({ "cf-turnstile-response": "www" }), { host: "www.example.com" });
    await expectRefused(response, 404, "not-for-sale");
  });

  it.each(["placeholder", "off", "removed"] as const)("answers a %s domain like an unknown one", async (status) => {
    await addDomain("parked.example", status);
    hosting.acceptBotToken("parked", "parked.example");
    const parked = await postJson(offer({ "cf-turnstile-response": "parked" }), { host: "parked.example" });
    const unknown = await postJson(offer(), { host: "unknown.example" });
    expect(parked.status).toBe(404);
    expect(await parked.text()).toBe(await unknown.text());
    expect(await stored()).toEqual([]);
  });

  it("reads the host case-insensitively and without the port", async () => {
    const request = new Request("https://EXAMPLE.com:8443/api/offer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(offer()),
    });
    const response = await handleOffer(request, { db, hosting, sessionKey: SESSION_KEY, now });
    expect(response.status).toBe(200);
  });

  it("answers a filled honeypot like a success and does nothing", async () => {
    const json = await postJson(offer({ website: "https://spam.example" }));
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ ok: true });
    const form = await postForm(offer({ website: "x" }));
    expect(form.headers.get("location")).toBe("/#offer-sent");
    expect(await stored()).toEqual([]);
    expect(hosting.sent).toEqual([]);
    expect(requestStatements()).toEqual([]);
  });

  it("refuses a missing, unknown, reused or wrong-host bot token", async () => {
    const { "cf-turnstile-response": _, ...withoutToken } = offer();
    await expectRefused(await postJson(withoutToken), 403, "bot-check");
    await expectRefused(await postJson(offer({ "cf-turnstile-response": "  " })), 403, "bot-check");
    await expectRefused(await postJson(offer({ "cf-turnstile-response": "made-up" })), 403, "bot-check");
    await expectRefused(await postJson(offer({ "cf-turnstile-response": token("other.example") })), 403, "bot-check");

    const used = token();
    expect((await postJson(offer({ "cf-turnstile-response": used }))).status).toBe(200);
    const again = await postJson(offer({ "cf-turnstile-response": used }));
    expect(again.status).toBe(403);
    expect(await stored()).toHaveLength(1);
  });

  it("passes the domain's widget secret name and the visitor's IP to the bot check", async () => {
    const verify = vi.spyOn(hosting, "verifyBotCheck");
    const value = token();
    await postJson(offer({ "cf-turnstile-response": value }));
    expect(verify).toHaveBeenCalledWith({
      token: value,
      host: HOST,
      secretRef: "TURNSTILE_SECRET_1",
      remoteIp: "203.0.113.7",
    });
  });

  it("answers 503 when the bot check cannot be reached or has no secret", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    hosting.failNext("verifyBotCheck", new HostingError("unavailable", "down"));
    await expectRefused(await postJson(offer()), 503, "unavailable");
    vi.spyOn(hosting, "verifyBotCheck").mockResolvedValueOnce({ ok: false, reason: "not-configured" });
    await expectRefused(await postJson(offer()), 503, "unavailable");
    errors.mockRestore();
  });

  it("refuses an amount below the domain's minimum", async () => {
    const response = await postJson(offer({ amount: MIN_OFFER - 1 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Offers start at 500 EUR",
      code: "min-offer",
      field: "amount",
    });
    expect((await postJson(offer({ amount: MIN_OFFER }))).status).toBe(200);
  });

  it.each([0, -5, 1500.5, 1_000_000_000, "1500.50", "1e5", "12 34", "", null, [1500]])(
    "refuses the amount %j",
    async (amount) => {
      await expectRefused(await postJson(offer({ amount })), 400, "invalid", "amount");
    },
  );

  it.each([
    ["1500", 150_000],
    ["1,500", 150_000],
    ["1.500", 150_000],
    ["12 500", 1_250_000],
    [" 2000 ", 200_000],
  ])("reads the form amount %j", async (amount, amountMinor) => {
    expect((await postForm(offer({ amount }))).headers.get("location")).toBe("/#offer-sent");
    expect(await stored()).toMatchObject([{ amountMinor }]);
  });

  it.each([
    "",
    "jane",
    "jane@buyer",
    "jane@@buyer.example",
    "jane buyer@buyer.example",
    "jane@buyer.example\r\nBcc: victim@example.org",
    "jane@buyer.example, victim@example.org",
    '"jane"@buyer.example',
    "Jane <jane@buyer.example>",
    `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.example`,
    42,
  ])("refuses the email %j", async (email) => {
    await expectRefused(await postJson(offer({ email })), 400, "invalid", "email");
  });

  it.each([
    "",
    "   ",
    "a".repeat(101),
    "Jane\r\nBcc: victim@example.org",
    "Jane\nSubject: hi",
    "Jane Buyer",
    "Jane\u0000",
    7,
  ])("refuses the name %j", async (name) => {
    await expectRefused(await postJson(offer({ name })), 400, "invalid", "name");
  });

  it("trims the name and the email", async () => {
    await postJson(offer({ name: "  Jane Buyer \n", email: " jane@buyer.example " }));
    expect(await stored()).toMatchObject([{ name: "Jane Buyer", email: "jane@buyer.example" }]);
    expect(hosting.sent[0]?.replyTo).toEqual({ email: "jane@buyer.example", name: "Jane Buyer" });
  });

  it("refuses a message that is too long or holds control characters", async () => {
    await expectRefused(await postJson(offer({ message: "a".repeat(2001) })), 400, "invalid");
    await expectRefused(await postJson(offer({ message: "hi\u0000there" })), 400, "invalid");
    await expectRefused(await postJson(offer({ message: { text: "hi" } })), 400, "invalid");
  });

  it("refuses a body over 10 KB before parsing it, declared or not", async () => {
    const big = JSON.stringify(offer({ message: "a".repeat(MAX_BODY_BYTES) }));
    await expectRefused(await postJson(JSON.parse(big) as Fields), 413, "invalid");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const request = new Request(`https://${HOST}/api/offer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    const response = await handleOffer(request, { db, hosting, sessionKey: SESSION_KEY, now });
    await expectRefused(response, 413, "invalid");
    expect(requestStatements()).toEqual([]);
  });

  it("refuses other methods and content types", async () => {
    const get = await send({ method: "GET" });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect((await send({ method: "OPTIONS" })).status).toBe(405);
    expect((await send({ method: "PUT", body: "{}", headers: { "content-type": "application/json" } })).status).toBe(
      405,
    );

    const text = await send({ body: JSON.stringify(offer()), headers: { "content-type": "text/plain" } });
    expect(text.status).toBe(303);
    expect(text.headers.get("location")).toBe("/#offer-error-failed");
    const multipart = await send({
      body: "x",
      headers: { "content-type": "multipart/form-data; boundary=x", accept: "application/json" },
    });
    await expectRefused(multipart, 415, "invalid");
    await expectRefused(await send({ body: "[1]", headers: { "content-type": "application/json" } }), 400, "invalid");
    await expectRefused(await send({ body: "{", headers: { "content-type": "application/json" } }), 400, "invalid");
  });

  it("throttles per IP, across hosts, and lets the window pass", async () => {
    for (let attempt = 0; attempt < OFFER_BURST.max; attempt++) {
      expect((await postJson(offer())).status).toBe(200);
    }
    const blocked = await postJson(offer());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe(String(OFFER_BURST.windowMs / 1000));
    expect(await blocked.json()).toMatchObject({ ok: false, code: "rate-limited" });
    expect(await stored()).toHaveLength(OFFER_BURST.max);

    const elsewhere = await postJson(offer(), { headers: { "CF-Connecting-IP": "198.51.100.9" } });
    expect(elsewhere.status).toBe(200);

    now += OFFER_BURST.windowMs;
    expect((await postJson(offer())).status).toBe(200);
  });

  it("counts an IPv6 /64 as one visitor and stores no address", async () => {
    for (let attempt = 0; attempt <= OFFER_BURST.max; attempt++) {
      const response = await postJson(offer(), { headers: { "CF-Connecting-IP": `2001:db8:1:2::${attempt + 1}` } });
      expect(response.status).toBe(attempt < OFFER_BURST.max ? 200 : 429);
    }
    const params = JSON.stringify(executed.map((statement) => statement.params));
    expect(params).not.toContain("2001:db8");
    expect(params).toMatch(/"offer:[0-9a-f]{64}"/);
  });

  it("caps offers per IP over the long window", async () => {
    let accepted = 0;
    while (accepted < OFFER_SUSTAINED.max) {
      for (let attempt = 0; attempt < OFFER_BURST.max; attempt++, accepted++) {
        expect((await postJson(offer())).status).toBe(200);
      }
      now += OFFER_BURST.windowMs;
    }
    expect((await postJson(offer())).status).toBe(429);
    now += OFFER_SUSTAINED.windowMs;
    expect((await postJson(offer())).status).toBe(200);
  });

  it("does not count a mistyped form against the visitor", async () => {
    for (let attempt = 0; attempt < OFFER_BURST.max * 2; attempt++) {
      expect((await postJson(offer({ email: "nope" }))).status).toBe(400);
    }
    expect((await postJson(offer())).status).toBe(200);
  });

  it("answers a form post without JavaScript with a redirect on the same host", async () => {
    const cases: [Fields, string][] = [
      [offer(), "/#offer-sent"],
      [offer({ amount: "12" }), "/#offer-error-amount"],
      [offer({ amount: "abc" }), "/#offer-error-amount"],
      [offer({ name: "" }), "/#offer-error-name"],
      [offer({ email: "nope" }), "/#offer-error-email"],
      [offer({ "cf-turnstile-response": "" }), "/#offer-error-check"],
      [offer({ message: "a".repeat(2001) }), "/#offer-error-failed"],
    ];
    for (const [fields, location] of cases) {
      const response = await postForm(fields);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(location);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
    }
    const unknown = await postForm(offer(), { host: "unknown.example" });
    expect(unknown.headers.get("location")).toBe("/#offer-error-failed");
  });

  it("never redirects anywhere a request names", async () => {
    const response = await send({
      body: new URLSearchParams({
        ...(offer() as Record<string, string>),
        amount: "1500",
        next: "https://evil.example/",
        redirect: "//evil.example",
        name: "//evil.example",
      }).toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: "https://evil.example/",
        origin: "https://evil.example",
        "x-forwarded-host": "evil.example",
      },
    });
    expect(response.headers.get("location")).toBe("/#offer-sent");
  });

  it("answers a form post that accepts JSON with JSON", async () => {
    const body = new URLSearchParams({ ...(offer() as Record<string, string>), amount: "1500" }).toString();
    const response = await send({
      body,
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", accept: "application/json" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("ignores a country header that is not a country", async () => {
    await postJson(offer(), { headers: { "CF-IPCountry": "XX" } });
    await postJson(offer(), { headers: { "CF-IPCountry": "<script>" } });
    expect((await stored()).map((row) => row.country)).toEqual([null, null]);
  });

  it("keeps buyer data out of the logs when the database fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const broken = { ...hosting, verifyBotCheck: () => Promise.reject(new Error("Jane Buyer jane@buyer.example")) };
    const request = new Request(`https://${HOST}/api/offer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(offer()),
    });
    const response = await handleOffer(request, { db, hosting: broken, sessionKey: SESSION_KEY, now });
    expect(response.status).toBe(503);
    const logged = JSON.stringify([...errors.mock.calls, ...logs.mock.calls]);
    expect(logged).not.toMatch(/jane|1500/i);
    errors.mockRestore();
    logs.mockRestore();
  });
});
