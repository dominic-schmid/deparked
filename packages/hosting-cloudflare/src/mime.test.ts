import { HostingError } from "@deparked/hosting";
import { describe, expect, it } from "vitest";
import { buildMimeMessage, type MimeInput } from "./mime";

const BASE: MimeInput = {
  from: { email: "offers@example.com", name: "Deparked" },
  to: "owner@example.com",
  replyTo: { email: "buyer@example.org", name: "Ada Buyer" },
  subject: "New offer for example.com",
  text: "Ada offers 1,500 EUR.",
  date: new Date("2026-11-12T09:30:00Z"),
  messageId: "id-1@example.com",
};

function parse(raw: string) {
  const [head = "", body = ""] = raw.split("\r\n\r\n");
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r\n[ \t]/g, " ").split("\r\n")) {
    const colon = line.indexOf(":");
    headers.set(line.slice(0, colon), line.slice(colon + 2));
  }
  return { headers, names: [...headers.keys()], text: Buffer.from(body, "base64").toString("utf8"), body, head };
}

const decodeWords = (value: string) =>
  value
    .replace(/\?=\s+(?==\?UTF-8\?B\?)/g, "?=")
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_all, word: string) => Buffer.from(word, "base64").toString("utf8"));

describe("buildMimeMessage", () => {
  it("builds a plain-text message with the offer's headers", () => {
    const { headers, text } = parse(buildMimeMessage(BASE));
    expect(Object.fromEntries(headers)).toEqual({
      From: '"Deparked" <offers@example.com>',
      To: "owner@example.com",
      "Reply-To": '"Ada Buyer" <buyer@example.org>',
      Subject: "New offer for example.com",
      Date: "Thu, 12 Nov 2026 09:30:00 +0000",
      "Message-ID": "<id-1@example.com>",
      "MIME-Version": "1.0",
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Transfer-Encoding": "base64",
    });
    expect(text).toBe("Ada offers 1,500 EUR.");
  });

  it("keeps line breaks in a name or subject from adding headers", () => {
    const raw = buildMimeMessage({
      ...BASE,
      replyTo: { email: "buyer@example.org", name: "Ada\r\nBcc: victim@example.net" },
      subject: "Offer\nBcc: victim@example.net\r\n\r\nInjected body X-A: b\u0085c\u0000d",
    });
    const { names, headers, text } = parse(raw);
    expect(names).toEqual([
      "From",
      "To",
      "Reply-To",
      "Subject",
      "Date",
      "Message-ID",
      "MIME-Version",
      "Content-Type",
      "Content-Transfer-Encoding",
    ]);
    expect(headers.get("Reply-To")).toBe('"Ada Bcc: victim@example.net" <buyer@example.org>');
    expect(decodeWords(headers.get("Subject") ?? "")).toBe("Offer Bcc: victim@example.net Injected body X-A: b c d");
    expect(text).toBe(BASE.text);
  });

  it.each([
    ["a line break", "buyer@example.org\r\nBcc: victim@example.net"],
    ["a second recipient", "buyer@example.org, victim@example.net"],
    ["angle brackets", "buyer@example.org> <victim@example.net"],
    ["a space", "buyer @example.org"],
    ["no domain", "buyer"],
    ["non-ASCII characters", "büyer@example.org"],
    ["an absurd length", `${"a".repeat(250)}@example.org`],
  ])("refuses a reply address with %s", (_name, email) => {
    expect(() => buildMimeMessage({ ...BASE, replyTo: { email } })).toThrow(HostingError);
  });

  it("refuses a malformed recipient or sender", () => {
    expect(() => buildMimeMessage({ ...BASE, to: "owner@example.com\nBcc: x@example.net" })).toThrow(HostingError);
    expect(() => buildMimeMessage({ ...BASE, from: { email: "offers@exa mple.com" } })).toThrow(HostingError);
  });

  it("quotes names so quotes and backslashes can't end the display name early", () => {
    const { headers } = parse(
      buildMimeMessage({ ...BASE, replyTo: { email: "b@example.org", name: 'A "B" \\ <x@y.z>' } }),
    );
    expect(headers.get("Reply-To")).toBe('"A \\"B\\" \\\\ <x@y.z>" <b@example.org>');
  });

  it("encodes non-ASCII names and subjects as RFC 2047 words of at most 75 characters", () => {
    const name = "Zoë Müller-Łukasiewicz 山田太郎 🙂";
    const subject = `Angebot für example.com: 1.500 € ${"ü🙂".repeat(40)}`;
    const raw = buildMimeMessage({ ...BASE, replyTo: { email: "b@example.org", name }, subject });
    const { headers, head } = parse(raw);
    expect(head).toMatch(/^[\x20-\x7e\r\n]*$/);
    expect(decodeWords(headers.get("Reply-To") ?? "")).toBe(`${name} <b@example.org>`);
    expect(decodeWords(headers.get("Subject") ?? "")).toBe(subject);
    for (const word of head.match(/=\?UTF-8\?B\?[^?]*\?=/g) ?? []) expect(word.length).toBeLessThanOrEqual(75);
  });

  it("keeps every line short, whatever the input", () => {
    const text = `${"x".repeat(5000)}\nsecond line with ünïcödé\r\nthird`;
    const raw = buildMimeMessage({ ...BASE, subject: "s".repeat(600), text });
    for (const line of raw.split("\r\n")) expect(line.length).toBeLessThanOrEqual(78);
    expect(raw).not.toMatch(/[^\r]\n|\r[^\n]/);
    const parsed = parse(raw);
    expect(parsed.text).toBe(`${"x".repeat(5000)}\r\nsecond line with ünïcödé\r\nthird`);
    expect(decodeWords(parsed.headers.get("Subject") ?? "")).toBe("s".repeat(600));
  });

  it("a body that looks like headers stays in the body", () => {
    const { names, text } = parse(buildMimeMessage({ ...BASE, text: "\r\n\r\nBcc: victim@example.net\r\n.\r\n" }));
    expect(names).not.toContain("Bcc");
    expect(text).toBe("\r\n\r\nBcc: victim@example.net\r\n.\r\n");
  });
});
