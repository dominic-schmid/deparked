import { insertDomain, insertOffer, setDomainStatus, setWorkspaceMark } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { describe, expect, test } from "vitest";
import { HOST, NOW, seed } from "./test-seed";
import { loadUninstallFacts } from "./uninstall";
import { uninstallCopyGate } from "./uninstall-gate";

const facts = { offers: 3, domains: 1, newestOfferAt: NOW, exportedAt: null };

describe("the copy of the offers before Uninstall", () => {
  test("with no offers there is nothing to keep", () => {
    expect(uninstallCopyGate({ ...facts, offers: 0, newestOfferAt: null }, false)).toEqual({ ok: true });
  });

  test("needs a download or the tick", () => {
    expect(uninstallCopyGate(facts, false)).toEqual({
      ok: false,
      reason: "Download your offers first, or tick that you need no copy.",
    });
    expect(uninstallCopyGate(facts, true)).toEqual({ ok: true });
    expect(uninstallCopyGate({ ...facts, exportedAt: NOW + 1 }, false)).toEqual({ ok: true });
  });

  test("a download not started after the newest offer does not count", () => {
    // Started in the same millisecond: the offer may have arrived after the read.
    expect(uninstallCopyGate({ ...facts, exportedAt: NOW }, false)).toMatchObject({ ok: false });
    expect(uninstallCopyGate({ ...facts, exportedAt: NOW - 1 }, false)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("after your last download"),
    });
  });

  test("counts every offer, removed domains included, and the domains still managed", async () => {
    const { db } = await createTestDb();
    await seed(db);
    await insertDomain(db, { domain: { host: "gone.example", zoneId: "z" }, now: NOW });
    await setDomainStatus(db, { host: "gone.example", status: "removed", now: NOW });
    const buyer = { currency: "EUR", name: "Buyer", email: "buyer@example.com", amountMinor: 100 };
    await insertOffer(db, { offer: { ...buyer, host: HOST }, now: NOW });
    await insertOffer(db, { offer: { ...buyer, host: "gone.example" }, now: NOW + 4 });
    await setWorkspaceMark(db, { mark: "offers-exported", now: NOW + 2 });
    expect(await loadUninstallFacts(db)).toEqual({
      offers: 2,
      domains: 1,
      newestOfferAt: NOW + 4,
      exportedAt: NOW + 2,
    });
  });
});
