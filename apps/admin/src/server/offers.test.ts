import { getOffer, insertOffer } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { describe, expect, test } from "vitest";
import { replyHref } from "../components/format";
import {
  changeOfferStatus,
  csvCell,
  exportFilename,
  exportOffers,
  INBOX_PAGE_SIZE,
  loadOffer,
  loadOffers,
  offerBackPath,
  offerPageSchema,
  offerStatusChangeSchema,
  offersCsv,
} from "./offers";
import { HOST, NOW, seed } from "./test-seed";

async function seeded() {
  const test = await createTestDb();
  await seed(test.db);
  return test.db;
}

const buyer = { host: HOST, amountMinor: 150_000, currency: "USD", name: "Buyer", email: "buyer@example.com" };

describe("offer status", () => {
  test("changes the status of an offer and reports an unknown id", async () => {
    const db = await seeded();
    const offer = await insertOffer(db, { offer: buyer, now: NOW });

    expect(await changeOfferStatus(db, { id: offer.id, status: "replied", now: NOW + 5 })).toBe(true);
    expect(await getOffer(db, offer.id)).toMatchObject({ status: "replied", updatedAt: NOW + 5 });
    expect(await changeOfferStatus(db, { id: offer.id, status: "new", now: NOW + 6 })).toBe(true);
    expect((await getOffer(db, offer.id))?.status).toBe("new");
    expect(await changeOfferStatus(db, { id: "missing", status: "ignored", now: NOW })).toBe(false);
  });

  test("the input rejects a status that does not exist", () => {
    expect(offerStatusChangeSchema.safeParse({ id: "01", status: "deleted" }).success).toBe(false);
    expect(offerStatusChangeSchema.safeParse({ id: "", status: "new" }).success).toBe(false);
    expect(offerPageSchema.safeParse({ status: "spam" }).success).toBe(false);
    expect(offerPageSchema.parse({ host: " Example.COM " })).toEqual({ host: "example.com" });
  });
});

describe("inbox pages", () => {
  test("pages newest first with a cursor, filtered by status", async () => {
    const db = await seeded();
    for (let index = 0; index < INBOX_PAGE_SIZE + 3; index++) {
      const offer = await insertOffer(db, { offer: { ...buyer, amountMinor: index }, now: NOW + index });
      if (index === 0) await changeOfferStatus(db, { id: offer.id, status: "ignored", now: NOW });
    }

    const first = await loadOffers(db, {});
    expect(first.offers).toHaveLength(INBOX_PAGE_SIZE);
    expect(first.offers[0]?.amountMinor).toBe(INBOX_PAGE_SIZE + 2);
    if (first.next === null) throw new Error("expected a second page");
    const second = await loadOffers(db, { before: first.next });
    expect(second.offers.map((offer) => offer.amountMinor)).toEqual([2, 1, 0]);
    expect(second.next).toBeNull();

    expect((await loadOffers(db, { status: "ignored" })).offers.map((offer) => offer.amountMinor)).toEqual([0]);
    expect((await loadOffers(db, { host: "other.example" })).offers).toEqual([]);
  });

  test("pages highest first, newest of equal amounts first", async () => {
    const db = await seeded();
    for (const [index, amountMinor] of [500, 90_000, 500, 7].entries()) {
      await insertOffer(db, { offer: { ...buyer, amountMinor, name: `Buyer ${index}` }, now: NOW + index });
    }
    const page = await loadOffers(db, { sort: "highest" });
    expect(page.offers.map((offer) => offer.name)).toEqual(["Buyer 1", "Buyer 2", "Buyer 0", "Buyer 3"]);
    expect(offerPageSchema.safeParse({ sort: "cheapest" }).success).toBe(false);
  });

  test("each offer says where it stands on its domain", async () => {
    const db = await seeded();
    for (const [index, amountMinor] of [250_000, 850_000, 120_000].entries()) {
      await insertOffer(db, { offer: { ...buyer, amountMinor, name: `Buyer ${index}` }, now: NOW + index });
    }
    const page = await loadOffers(db, {});
    expect(page.offers.map((offer) => [offer.name, offer.context])).toEqual([
      ["Buyer 2", { ordinal: 3, total: 3, bestAmountMinor: 850_000, bestCurrency: "USD" }],
      ["Buyer 1", { ordinal: 2, total: 3, bestAmountMinor: 850_000, bestCurrency: "USD" }],
      ["Buyer 0", { ordinal: 1, total: 3, bestAmountMinor: 850_000, bestCurrency: "USD" }],
    ]);
    const oldest = page.offers.at(-1);
    expect(await loadOffer(db, oldest?.id ?? "")).toEqual(oldest);
    expect(await loadOffer(db, "missing")).toBeNull();
    expect((await loadOffers(db, { status: "ignored" })).offers).toEqual([]);
  });
});

describe("the way back from the no-JavaScript status form", () => {
  test.each([
    ["/admin/offers", "/admin/offers"],
    ["/admin/offers?status=new&offer=01ABC", "/admin/offers?status=new&offer=01ABC"],
    ["/admin/d/example.com/offers?sort=highest", "/admin/d/example.com/offers?sort=highest"],
    ["/admin/offers?host=example.com", "/admin/offers?host=example.com"],
    ["https://evil.example/admin/offers", "/admin/offers"],
    ["//evil.example/admin/offers", "/admin/offers"],
    ["/admin/offers/../settings", "/admin/offers"],
    ["/admin/offers?x=1#frag", "/admin/offers"],
    ["/admin/settings", "/admin/offers"],
    [undefined, "/admin/offers"],
  ])("%s goes to %s", (value, path) => expect(offerBackPath(value)).toBe(path));
});

describe("CSV export", () => {
  test.each([
    ["=1+1", "'=1+1"],
    ["+1 555 0100", "'+1 555 0100"],
    ["-2", "'-2"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tcmd", "'\tcmd"],
    ["\rcmd", `"'\rcmd"`],
    ['=HYPERLINK("http://x","y")', `"'=HYPERLINK(""http://x"",""y"")"`],
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["two\nlines", '"two\nlines"'],
    ["", ""],
    ["1500.00", "1500.00"],
  ])("cell %j is written as %j", (value, cell) => {
    expect(csvCell(value)).toBe(cell);
  });

  test("writes a header and one quoted, defused row per offer", async () => {
    const db = await seeded();
    await insertOffer(db, {
      offer: { ...buyer, name: '=cmd|"/c calc"!A1', country: "DE", message: "Line one,\nline two" },
      now: NOW,
    });
    await insertOffer(db, { offer: { ...buyer, amountMinor: 5000, currency: "JPY", name: "山田" }, now: NOW + 1 });

    const csv = offersCsv(await exportOffers(db, {}));

    expect(csv).toBe(
      [
        "﻿received_at,domain,amount,currency,name,email,country,message,status,email_status,email_error",
        `${new Date(NOW + 1).toISOString()},example.com,5000,JPY,山田,buyer@example.com,,,new,pending,`,
        `${new Date(NOW).toISOString()},example.com,1500.00,USD,"'=cmd|""/c calc""!A1",buyer@example.com,DE,"Line one,\nline two",new,pending,`,
        "",
      ].join("\r\n"),
    );
  });

  test("exports every page of the current filter only", async () => {
    const db = await seeded();
    for (let index = 0; index < 205; index++) {
      const offer = await insertOffer(db, { offer: buyer, now: NOW + index });
      if (index % 2 === 0) await changeOfferStatus(db, { id: offer.id, status: "replied", now: NOW });
    }
    const all = await exportOffers(db, {});
    expect(all.offers).toHaveLength(205);
    expect(all.truncated).toBe(false);
    expect((await exportOffers(db, { status: "replied" })).offers).toHaveLength(103);
    expect((await exportOffers(db, { host: "other.example" })).offers).toHaveLength(0);
  });

  test("an export that hits the cap says so on its last line", async () => {
    const db = await seeded();
    for (let index = 0; index < 201; index++) await insertOffer(db, { offer: buyer, now: NOW + index });

    const capped = await exportOffers(db, {}, 1);
    expect(capped.offers).toHaveLength(200);
    expect(capped.truncated).toBe(true);
    const lines = offersCsv(capped).trimEnd().split("\r\n");
    expect(lines).toHaveLength(202);
    expect(lines.at(-1)).toMatch(/^INCOMPLETE EXPORT: this file holds only the newest 200 offers\./);

    const exact = await exportOffers(db, { status: "new" }, 2);
    expect(exact.truncated).toBe(false);
    expect(offersCsv(exact)).not.toContain("INCOMPLETE");
  });

  test("names the file after the filter and cannot break out of the header", () => {
    expect(exportFilename({}, NOW)).toBe("offers-2027-01-15.csv");
    expect(exportFilename({ host: "example.com", status: "new" }, NOW)).toBe("offers-example.com-new-2027-01-15.csv");
    expect(exportFilename({ host: 'a"\r\nb.com' }, NOW)).toBe("offers-ab.com-2027-01-15.csv");
  });
});

test("the reply link encodes the address and the subject", () => {
  expect(replyHref("buyer@example.com", "example.com")).toBe(
    "mailto:buyer@example.com?subject=Your%20offer%20for%20example.com",
  );
  expect(replyHref("a&b?cc=x@example.com", "exämple.com")).toBe(
    "mailto:a%26b%3Fcc%3Dx@example.com?subject=Your%20offer%20for%20ex%C3%A4mple.com",
  );
});
