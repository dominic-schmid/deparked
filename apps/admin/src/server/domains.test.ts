import { insertDomain, insertOffer, publishConfig, replaceSiteFiles, setDomainStatus } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { expect, test } from "vitest";
import { loadDomain, loadOverview } from "./domains";
import { HOST, NOW, seed } from "./test-seed";

test("the overview shows each domain's status, offers, best offer and last publish", async () => {
  const { db } = await createTestDb();
  await seed(db);
  await insertDomain(db, { domain: { host: "draft.example", zoneId: "z" }, now: NOW });
  await insertDomain(db, { domain: { host: "pending.example", zoneId: "z", status: "live" }, now: NOW });
  await insertDomain(db, { domain: { host: "gone.example", zoneId: "z", status: "removed" }, now: NOW });
  await insertDomain(db, { domain: { host: "off.example", zoneId: "z" }, now: NOW });
  await setDomainStatus(db, { host: "off.example", status: "off", now: NOW });
  await setDomainStatus(db, { host: HOST, status: "live", now: NOW });
  await publishConfig(db, { host: HOST, json: "{}", schemaVersion: 1, release: null, now: NOW + 7 });
  const buyer = { host: HOST, currency: "EUR", name: "Buyer", email: "buyer@example.com" };
  await insertOffer(db, { offer: { ...buyer, amountMinor: 100 }, now: NOW });
  await insertOffer(db, { offer: { ...buyer, amountMinor: 900 }, now: NOW + 1 });

  expect(await loadOverview(db, NOW)).toEqual([
    {
      host: "draft.example",
      status: "draft",
      mail: { state: "unassigned" },
      offers: 0,
      newOffers: 0,
      recentOffers: 0,
      best: null,
      publishedAt: null,
    },
    {
      host: HOST,
      status: "live",
      mail: { state: "ok", email: "owner@example.com" },
      offers: 2,
      newOffers: 2,
      recentOffers: 2,
      best: { amountMinor: 900, currency: "EUR" },
      publishedAt: NOW + 7,
    },
    {
      host: "off.example",
      status: "off",
      mail: { state: "unassigned" },
      offers: 0,
      newOffers: 0,
      recentOffers: 0,
      best: null,
      publishedAt: null,
    },
    {
      host: "pending.example",
      status: "email_pending",
      mail: { state: "unassigned" },
      offers: 0,
      newOffers: 0,
      recentOffers: 0,
      best: null,
      publishedAt: null,
    },
  ]);
});

test("a domain page exists only for a managed host", async () => {
  const { db } = await createTestDb();
  await seed(db);
  await insertDomain(db, { domain: { host: "gone.example", zoneId: "z", status: "removed" }, now: NOW });

  expect(await loadDomain(db, HOST)).toEqual({
    host: HOST,
    status: "draft",
    publishedAt: null,
    hasPages: false,
    notifyEmail: "owner@example.com",
    notifyVerified: true,
    mail: { state: "ok", email: "owner@example.com" },
  });
  await replaceSiteFiles(db, {
    host: HOST,
    files: [{ path: `/sites/${HOST}/index.html`, hash: "0".repeat(32), size: 1, contentType: "text/html" }],
    now: NOW,
  });
  expect(await loadDomain(db, HOST)).toMatchObject({ hasPages: true });
  expect(await loadDomain(db, "unknown.example")).toBeNull();
  expect(await loadDomain(db, "gone.example")).toBeNull();
});
