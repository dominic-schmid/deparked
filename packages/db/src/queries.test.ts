import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "./client";
import * as q from "./queries/index";
import type { Offer } from "./schema";
import { HOST, NOTIFY, NOW, SITEKEY, seed } from "./test-seed";
import { createTestDb } from "./testing";
import { ulid } from "./ulid";

let db: Db;

beforeEach(async () => {
  ({ db } = await createTestDb());
  await seed(db);
});

const password = { passwordHash: "hash", passwordSalt: "salt", passwordIterations: 100_000 };

describe("workspace", () => {
  test("init is idempotent and keeps the first row", async () => {
    const again = await q.initWorkspace(db, { cfAccountId: "account", now: NOW + 5 });
    expect(again).toMatchObject({ id: 1, cfAccountId: null, createdAt: NOW, sessionVersion: 1, setupDoneAt: null });
  });

  test("the setup secret works once", async () => {
    await q.setSetupSecret(db, { secretHash: "secret", expiresAt: NOW + 1000, now: NOW });

    expect(await q.consumeSetupSecret(db, { secretHash: "wrong", ...password, now: NOW + 1 })).toBeNull();
    expect((await q.getWorkspace(db))?.passwordHash).toBeNull();

    expect(await q.consumeSetupSecret(db, { secretHash: "secret", ...password, now: NOW + 1 })).toBe(2);
    expect(await q.getWorkspace(db)).toMatchObject({
      ...password,
      setupSecretHash: null,
      setupSecretExpiresAt: null,
      setupDoneAt: NOW + 1,
      sessionVersion: 2,
    });

    expect(await q.consumeSetupSecret(db, { secretHash: "secret", ...password, now: NOW + 2 })).toBeNull();
  });

  test("of two concurrent setups with the same secret, one wins", async () => {
    await q.setSetupSecret(db, { secretHash: "secret", expiresAt: NOW + 1000, now: NOW });
    const results = await Promise.all([
      q.consumeSetupSecret(db, { secretHash: "secret", ...password, passwordHash: "first", now: NOW + 1 }),
      q.consumeSetupSecret(db, { secretHash: "secret", ...password, passwordHash: "second", now: NOW + 1 }),
    ]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  test("an expired setup secret is refused", async () => {
    await q.setSetupSecret(db, { secretHash: "secret", expiresAt: NOW + 1000, now: NOW });
    expect(await q.consumeSetupSecret(db, { secretHash: "secret", ...password, now: NOW + 1000 })).toBeNull();
  });

  test("a new password and a bump each end all sessions", async () => {
    expect(await q.setPassword(db, { ...password, now: NOW })).toBe(2);
    expect(await q.bumpSessionVersion(db, NOW)).toBe(3);
  });

  test("install state starts at migrate and takes patches", async () => {
    expect(await q.getInstallState(db)).toMatchObject({ step: "migrate", stepStatus: "pending" });
    const next = await q.updateInstallState(db, { step: "sites", stepStatus: "failed", lastError: "boom" });
    expect(next).toMatchObject({ step: "sites", stepStatus: "failed", lastError: "boom" });
    expect(await q.initInstallState(db)).toEqual(next);
  });
});

describe("domains", () => {
  test("inserting an existing host changes nothing", async () => {
    expect(await q.insertDomain(db, { domain: { host: HOST, zoneId: "other" }, now: NOW + 1 })).toBeUndefined();
    expect((await q.getDomain(db, HOST))?.zoneId).toBe("zone-1");
  });

  test("status changes stamp and clear their timestamps", async () => {
    expect(await q.setDomainStatus(db, { host: HOST, status: "off", now: NOW + 1 })).toMatchObject({
      status: "off",
      turnedOffAt: NOW + 1,
    });
    expect(await q.setDomainStatus(db, { host: HOST, status: "live", now: NOW + 2 })).toMatchObject({
      status: "live",
      turnedOffAt: null,
      updatedAt: NOW + 2,
    });
    await q.setDomainStatus(db, { host: HOST, status: "removed", now: NOW + 3 });
    expect(await q.listDomains(db)).toEqual([]);
    expect(await q.listDomains(db, { includeRemoved: true })).toMatchObject([{ host: HOST, removedAt: NOW + 3 }]);
  });

  test("the offer target joins the widget secret name and the live config", async () => {
    expect(await q.getOfferTarget(db, "unmanaged.example")).toBeUndefined();
    expect(await q.getOfferTarget(db, HOST)).toEqual({
      host: HOST,
      status: "placeholder",
      notifyEmail: NOTIFY,
      senderHost: null,
      turnstileSecretName: "TURNSTILE_SECRET_1",
      liveJson: null,
      liveSchemaVersion: null,
    });
    await q.publishConfig(db, { host: HOST, json: '{"a":1}', schemaVersion: 2, release: null, now: NOW });
    expect(await q.getOfferTarget(db, HOST)).toMatchObject({ liveJson: '{"a":1}', liveSchemaVersion: 2 });
  });

  test("deleting a notify address clears it from its domains", async () => {
    expect(await q.deleteNotifyAddress(db, NOTIFY)).toBe(true);
    expect((await q.getDomain(db, HOST))?.notifyEmail).toBeNull();
    expect(await q.deleteNotifyAddress(db, NOTIFY)).toBe(false);
  });
});

describe("config", () => {
  test("publish sets live, keeps the draft and adds history", async () => {
    await q.saveDraft(db, { host: HOST, json: '{"v":1}', schemaVersion: 1, now: NOW });
    await q.publishConfig(db, { host: HOST, json: '{"v":1}', schemaVersion: 1, release: "1.0.0", now: NOW + 1 });
    await q.saveDraft(db, { host: HOST, json: '{"v":2}', schemaVersion: 1, now: NOW + 2 });
    await q.publishConfig(db, { host: HOST, json: '{"v":2}', schemaVersion: 1, release: "1.0.0", now: NOW + 3 });
    await q.saveDraft(db, { host: HOST, json: '{"v":3}', schemaVersion: 1, now: NOW + 4 });

    expect(await q.getConfig(db, HOST)).toEqual({
      host: HOST,
      draftJson: '{"v":3}',
      draftSchemaVersion: 1,
      liveJson: '{"v":2}',
      liveSchemaVersion: 1,
      updatedAt: NOW + 4,
      publishedAt: NOW + 3,
      publishedRelease: "1.0.0",
    });
    const history = await q.listConfigHistory(db, { host: HOST });
    expect(history.map((entry) => entry.json)).toEqual(['{"v":2}', '{"v":1}']);
    expect(await q.getConfigHistoryEntry(db, history[1]?.id ?? 0)).toEqual(history[1]);
  });

  test("a publish for an unknown host writes nothing", async () => {
    const publish = q.publishConfig(db, {
      host: "nope.example",
      json: "{}",
      schemaVersion: 1,
      release: null,
      now: NOW,
    });
    await expect(publish).rejects.toThrow();
    expect(await q.getConfig(db, "nope.example")).toBeUndefined();
  });
});

describe("offers", () => {
  const offer = { host: HOST, amountMinor: 50_000, currency: "USD", name: "Buyer", email: "buyer@example.com" };

  test("an offer is stored as new and pending, with a ULID", async () => {
    const stored = await q.insertOffer(db, { offer: { ...offer, message: "Hi" }, now: NOW });
    expect(stored).toMatchObject({ ...offer, status: "new", emailStatus: "pending", country: null, message: "Hi" });
    expect(stored.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await q.getOffer(db, stored.id)).toEqual(stored);
  });

  test("an offer for an unmanaged host is refused", async () => {
    await expect(q.insertOffer(db, { offer: { ...offer, host: "nope.example" }, now: NOW })).rejects.toThrow();
  });

  test("pages walk every offer once, newest first, also through equal timestamps", async () => {
    await q.insertDomain(db, { domain: { host: "other.example", zoneId: "zone-2" }, now: NOW });
    const times = [1, 2, 2, 2, 3, 4, 4];
    for (const time of times) await q.insertOffer(db, { offer, now: NOW + time });
    await q.insertOffer(db, { offer: { ...offer, host: "other.example" }, now: NOW + 9 });

    const seen: string[] = [];
    let before: q.OfferCursor | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await q.listOffers(
        db,
        before === undefined ? { host: HOST, limit: 3 } : { host: HOST, limit: 3, before },
      );
      seen.push(...result.offers.map((row) => row.id));
      if (result.next === null) break;
      before = result.next;
    }
    expect(seen).toHaveLength(times.length);
    expect(new Set(seen).size).toBe(times.length);
    expect(seen).toEqual([...seen].sort().reverse());

    expect((await q.listOffers(db)).offers).toHaveLength(times.length + 1);
    expect((await q.listOffers(db)).offers[0]?.host).toBe("other.example");
  });

  test("highest first: pages walk every offer once by amount, also through equal amounts", async () => {
    await q.insertDomain(db, { domain: { host: "other.example", zoneId: "zone-2" }, now: NOW });
    const amounts = [500, 90_000, 500, 1, 90_000, 7, 500];
    for (const [index, amountMinor] of amounts.entries()) {
      await q.insertOffer(db, { offer: { ...offer, amountMinor }, now: NOW + index });
    }
    await q.insertOffer(db, { offer: { ...offer, host: "other.example", amountMinor: 999_999 }, now: NOW });
    await q.insertOffer(db, { offer: { ...offer, amountMinor: 80_000 }, now: NOW + 20 });
    const replied = (await q.listOffers(db, { host: HOST, sort: "highest", limit: 1 })).offers[0];
    if (replied === undefined) throw new Error("no offer");
    await q.setOfferStatus(db, { id: replied.id, status: "replied", now: NOW });

    const walk = async (input: { host?: string; status?: "new" }) => {
      const seen: Offer[] = [];
      let before: q.OfferCursor | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await q.listOffers(db, { ...input, sort: "highest", limit: 2, ...(before ? { before } : {}) });
        seen.push(...result.offers);
        if (result.next === null) break;
        before = result.next;
      }
      return seen;
    };
    const host = await walk({ host: HOST });
    expect(host.map((row) => row.amountMinor)).toEqual([90_000, 90_000, 80_000, 500, 500, 500, 7, 1]);
    expect(new Set(host.map((row) => row.id)).size).toBe(8);
    expect((await walk({})).map((row) => row.amountMinor)[0]).toBe(999_999);
    expect(await walk({ status: "new" })).toHaveLength(8);
  });

  test("status filter, counts and stats", async () => {
    await q.insertDomain(db, { domain: { host: "other.example", zoneId: "zone-2" }, now: NOW });
    const first = await q.insertOffer(db, { offer, now: NOW });
    await q.insertOffer(db, { offer: { ...offer, amountMinor: 90_000, currency: "EUR" }, now: NOW + 1 });
    await q.insertOffer(db, { offer: { ...offer, host: "other.example", amountMinor: 1 }, now: NOW + 2 });
    expect(await q.setOfferStatus(db, { id: first.id, status: "replied", now: NOW + 3 })).toBe(true);
    expect(await q.setOfferStatus(db, { id: "missing", status: "replied", now: NOW + 3 })).toBe(false);

    expect((await q.listOffers(db, { status: "replied" })).offers.map((row) => row.id)).toEqual([first.id]);
    expect((await q.listOffers(db, { host: HOST, status: "new" })).offers).toHaveLength(1);
    expect(await q.countNewOffers(db)).toBe(2);
    expect(await q.countNewOffers(db, HOST)).toBe(1);
    expect(await q.offerStatsForHosts(db, [])).toEqual([]);
    expect(await q.offerStatsForHosts(db, [HOST, "other.example", "none.example"])).toEqual([
      { host: HOST, total: 2, newCount: 1, recentCount: 2, bestAmountMinor: 90_000, bestCurrency: "EUR" },
      { host: "other.example", total: 1, newCount: 1, recentCount: 1, bestAmountMinor: 1, bestCurrency: "USD" },
    ]);
    expect(await q.offerStatsForHosts(db, [HOST, "other.example"], NOW + 1)).toMatchObject([
      { host: HOST, total: 2, recentCount: 1 },
      { host: "other.example", total: 1, recentCount: 1 },
    ]);
  });

  test("an offer knows its place among its domain's offers", async () => {
    await q.insertDomain(db, { domain: { host: "other.example", zoneId: "zone-2" }, now: NOW });
    const first = await q.insertOffer(db, { offer, now: NOW });
    const elsewhere = await q.insertOffer(db, { offer: { ...offer, host: "other.example" }, now: NOW + 1 });
    const second = await q.insertOffer(db, { offer, now: NOW + 2 });
    // Same millisecond: the id decides, as in the list.
    const third = await q.insertOffer(db, { offer, now: NOW + 2 });
    const [later, earlier] = [second, third].sort((a, b) => (a.id < b.id ? 1 : -1)) as [Offer, Offer];
    const ordinals = await q.offerOrdinals(db, [first.id, elsewhere.id, later.id, earlier.id, "missing"]);
    expect(Object.fromEntries(ordinals)).toEqual({
      [first.id]: 1,
      [elsewhere.id]: 1,
      [earlier.id]: 2,
      [later.id]: 3,
    });
    expect(await q.offerOrdinals(db, [])).toEqual(new Map());
  });

  test("the email outcome is recorded", async () => {
    const stored = await q.insertOffer(db, { offer, now: NOW });
    await q.setOfferEmailStatus(db, { id: stored.id, emailStatus: "failed", emailError: "rejected", now: NOW + 1 });
    expect(await q.getOffer(db, stored.id)).toMatchObject({ emailStatus: "failed", emailError: "rejected" });
    await q.setOfferEmailStatus(db, { id: stored.id, emailStatus: "sent", notifiedTo: NOTIFY, now: NOW + 2 });
    expect(await q.getOffer(db, stored.id)).toMatchObject({
      emailStatus: "sent",
      emailError: null,
      notifiedTo: NOTIFY,
      updatedAt: NOW + 2,
    });
  });
});

describe("notify addresses and Turnstile widgets", () => {
  test("adding an address twice keeps the first", async () => {
    expect(await q.insertNotifyAddress(db, { email: NOTIFY, now: NOW + 1 })).toBe(false);
    expect(await q.insertNotifyAddress(db, { email: "second@example.com", now: NOW + 1 })).toBe(true);
    await q.updateNotifyAddress(db, {
      email: "second@example.com",
      patch: { cfAddressId: "id", lastResentAt: NOW + 2 },
    });
    expect(await q.listNotifyAddresses(db)).toEqual([
      { email: NOTIFY, cfAddressId: null, verifiedAt: NOW, lastResentAt: null, createdAt: NOW },
      { email: "second@example.com", cfAddressId: "id", verifiedAt: null, lastResentAt: NOW + 2, createdAt: NOW + 1 },
    ]);
  });

  test("a widget takes 10 hostnames and no more", async () => {
    const claims = [];
    for (let i = 0; i < 10; i++) claims.push(await q.claimTurnstileSlot(db, SITEKEY));
    expect(claims).toEqual([...Array(9).fill(true), false]);
    expect(await q.findTurnstileWidgetWithFreeSlot(db)).toBeUndefined();

    await q.insertTurnstileWidget(db, { sitekey: "second", name: "deparked-2", secretName: "S2", now: NOW + 1 });
    expect((await q.findTurnstileWidgetWithFreeSlot(db))?.sitekey).toBe("second");
    expect(await q.releaseTurnstileSlot(db, SITEKEY)).toBe(true);
    expect((await q.findTurnstileWidgetWithFreeSlot(db))?.sitekey).toBe(SITEKEY);
    expect(await q.releaseTurnstileSlot(db, "second")).toBe(false);
    expect((await q.listTurnstileWidgets(db)).map((widget) => widget.hostnameCount)).toEqual([9, 0]);
  });

  test("a domain is assigned one slot once, and never past 10 holders", async () => {
    const hosts = Array.from({ length: 10 }, (_, index) => `d${index}.example.com`);
    for (const host of hosts) await q.insertDomain(db, { domain: { host, zoneId: "zone-1" }, now: NOW });
    const assign = (host: string) => q.assignTurnstileWidget(db, { host, sitekey: SITEKEY, now: NOW + 1 });

    expect(await assign("d0.example.com")).toBe(true);
    expect(await assign("d0.example.com")).toBe(false);
    const rest = [];
    for (const host of hosts.slice(1)) rest.push(await assign(host));
    expect(rest).toEqual([...Array(8).fill(true), false]);
    expect((await q.listTurnstileWidgets(db))[0]?.hostnameCount).toBe(10);
    expect((await q.getDomain(db, "d9.example.com"))?.turnstileWidgetId).toBeNull();
  });
});

describe("site files", () => {
  const file = (path: string, hash = "h") => ({ path, hash, size: 1, contentType: "text/html" });

  test("replacing one host's files leaves the others and the catalog", async () => {
    const catalog = Array.from({ length: 40 }, (_, i) => file(`/catalog/${String(i).padStart(2, "0")}.avif`));
    await q.replaceSiteFiles(db, { host: null, files: catalog, now: NOW });
    await q.replaceSiteFiles(db, {
      host: HOST,
      files: [file("/sites/a/index.html"), file("/sites/a/old.txt")],
      now: NOW,
    });
    await q.replaceSiteFiles(db, { host: HOST, files: [file("/sites/a/index.html", "h2")], now: NOW + 1 });

    expect(await q.listSiteFilesByHost(db, HOST)).toEqual([
      { ...file("/sites/a/index.html", "h2"), host: HOST, updatedAt: NOW + 1 },
    ]);
    expect(await q.listSiteFilesByHost(db, null)).toHaveLength(40);
    expect(await q.listSiteFiles(db)).toHaveLength(41);
    expect(await q.deleteSiteFilesByHost(db, HOST)).toBe(1);
    await q.replaceSiteFiles(db, { host: null, files: [], now: NOW + 2 });
    expect(await q.listSiteFiles(db)).toEqual([]);
  });
});

describe("deployments and the publish lock", () => {
  test("only one deployment holds the lock until it releases or expires", async () => {
    const first = await q.insertDeployment(db, { worker: "sites", kind: "publish", host: HOST, now: NOW });
    const second = await q.insertDeployment(db, { worker: "sites", kind: "publish", now: NOW + 1 });

    expect(await q.acquirePublishLock(db, { deploymentId: first.id, ttlMs: 1000, now: NOW })).toBe(true);
    expect(await q.acquirePublishLock(db, { deploymentId: second.id, ttlMs: 1000, now: NOW + 999 })).toBe(false);
    expect(await q.getPublishLock(db)).toEqual({ id: 1, deploymentId: first.id, expiresAt: NOW + 1000 });

    expect(await q.acquirePublishLock(db, { deploymentId: second.id, ttlMs: 1000, now: NOW + 1000 })).toBe(true);
    expect(await q.releasePublishLock(db, first.id)).toBe(false);
    expect(await q.releasePublishLock(db, second.id)).toBe(true);
    expect(await q.getPublishLock(db)).toBeUndefined();
    expect(await q.acquirePublishLock(db, { deploymentId: first.id, ttlMs: 1000, now: NOW + 1001 })).toBe(true);
  });

  test("the provisioning lock has one holder until it releases or expires, and the holder can renew it", async () => {
    expect(await q.acquireProvisionLock(db, { holder: 1, ttlMs: 1000, now: NOW })).toBe(true);
    expect(await q.acquireProvisionLock(db, { holder: 2, ttlMs: 1000, now: NOW + 999 })).toBe(false);
    expect(await q.acquireProvisionLock(db, { holder: 1, ttlMs: 1000, now: NOW + 999 })).toBe(true);
    expect(await q.acquireProvisionLock(db, { holder: 2, ttlMs: 1000, now: NOW + 1998 })).toBe(false);
    expect(await q.acquireProvisionLock(db, { holder: 2, ttlMs: 1000, now: NOW + 1999 })).toBe(true);
    expect(await q.releaseProvisionLock(db, 1)).toBe(false);
    expect(await q.releaseProvisionLock(db, 2)).toBe(true);
    expect(await q.acquireProvisionLock(db, { holder: 1, ttlMs: 1000, now: NOW + 2000 })).toBe(true);
    // Rate limit windows are pruned after a day; a live lock is never that old.
    expect(await q.pruneRateLimits(db, NOW + 2000)).toBe(0);
  });

  test("a workspace mark keeps its latest time and survives the prune", async () => {
    expect(await q.getWorkspaceMark(db, "offers-exported")).toBeNull();
    await q.setWorkspaceMark(db, { mark: "offers-exported", now: NOW });
    await q.setWorkspaceMark(db, { mark: "offers-exported", now: NOW + 5 });
    expect(await q.getWorkspaceMark(db, "offers-exported")).toBe(NOW + 5);
    expect(await q.getWorkspaceMark(db, "setup-checklist-dismissed")).toBeNull();
    await q.hitRateLimit(db, { key: "login:abc", windowMs: 1000, now: NOW });
    expect(await q.pruneRateLimits(db, NOW + 10 * 86_400_000)).toBe(1);
    expect(await q.getWorkspaceMark(db, "offers-exported")).toBe(NOW + 5);
  });

  test("a deployment finishes once; latest is by worker and status", async () => {
    const first = await q.insertDeployment(db, { worker: "sites", kind: "install", releaseVersion: "1.0.0", now: NOW });
    const second = await q.insertDeployment(db, { worker: "sites", kind: "publish", host: HOST, now: NOW + 1 });
    await q.insertDeployment(db, { worker: "admin", kind: "install", now: NOW + 2 });

    expect(await q.finishDeployment(db, { id: first.id, status: "done", cfVersionId: "v1", now: NOW + 3 })).toBe(true);
    expect(await q.finishDeployment(db, { id: first.id, status: "failed", error: "late", now: NOW + 4 })).toBe(false);
    expect(await q.finishDeployment(db, { id: second.id, status: "failed", error: "boom", now: NOW + 5 })).toBe(true);

    expect(await q.getDeployment(db, first.id)).toMatchObject({
      status: "done",
      cfVersionId: "v1",
      finishedAt: NOW + 3,
    });
    expect((await q.latestDeployment(db, { worker: "sites" }))?.id).toBe(second.id);
    expect((await q.latestDeployment(db, { worker: "sites", status: "done" }))?.id).toBe(first.id);
    expect((await q.listDeployments(db, { worker: "sites" })).map((row) => row.id)).toEqual([second.id, first.id]);
  });
});

describe("ledger", () => {
  test("lists a host's entries newest first and skips undone ones on request", async () => {
    const entry = { zoneId: "zone-1", action: "created" as const, now: NOW };
    const route = await q.insertLedgerEntry(db, { ...entry, host: HOST, resource: "route", cfId: "r1" });
    const rule = await q.insertLedgerEntry(db, { ...entry, host: HOST, resource: "rule", cfId: "r2" });
    const changed = await q.insertLedgerEntry(db, {
      host: HOST,
      resource: "route",
      cfId: "r3",
      action: "changed",
      previousJson: '{"script":"old"}',
      now: NOW + 1,
    });
    const hub = await q.insertLedgerEntry(db, {
      resource: "worker",
      cfId: "deparked-sites",
      action: "created",
      now: NOW,
    });

    const ids = (rows: { id: number }[]) => rows.map((row) => row.id);
    expect(ids(await q.listLedger(db, { host: HOST }))).toEqual([changed.id, rule.id, route.id]);
    expect(ids(await q.listLedger(db, { host: null }))).toEqual([hub.id]);

    expect(await q.markLedgerUndone(db, { id: rule.id, now: NOW + 2 })).toBe(true);
    expect(await q.markLedgerUndone(db, { id: rule.id, now: NOW + 3 })).toBe(false);
    expect(ids(await q.listLedger(db, { host: HOST, activeOnly: true }))).toEqual([changed.id, route.id]);
    expect((await q.listLedger(db, { host: HOST }))[1]).toMatchObject({ undoneAt: NOW + 2 });
  });
});

describe("rate limits", () => {
  const hit = (now: number, key = "login:abc") => q.hitRateLimit(db, { key, windowMs: 1000, now });

  test("counts hits in a fixed window and starts over after it", async () => {
    expect(await hit(NOW)).toEqual({ count: 1, windowStart: NOW });
    expect(await hit(NOW + 500)).toEqual({ count: 2, windowStart: NOW });
    expect(await hit(NOW + 999)).toEqual({ count: 3, windowStart: NOW });
    expect(await hit(NOW + 1000)).toEqual({ count: 1, windowStart: NOW + 1000 });
    expect(await hit(NOW, "offer:abc")).toEqual({ count: 1, windowStart: NOW });
  });

  test("concurrent hits are all counted", async () => {
    const counts = (await Promise.all(Array.from({ length: 5 }, () => hit(NOW)))).map((result) => result.count);
    expect(counts.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test("a refund takes one hit back, only from the window it was counted in", async () => {
    const first = await hit(NOW);
    await hit(NOW + 1);
    await q.refundRateLimit(db, { key: "login:abc", windowStart: first.windowStart });
    expect(await hit(NOW + 2)).toEqual({ count: 2, windowStart: NOW });
    await q.refundRateLimit(db, { key: "login:abc", windowStart: NOW - 1 });
    expect(await hit(NOW + 3)).toEqual({ count: 3, windowStart: NOW });
  });

  test("clear forgets a key and prune drops old windows", async () => {
    await hit(NOW);
    await hit(NOW + 5000, "offer:abc");
    await q.clearRateLimit(db, "login:abc");
    expect(await hit(NOW + 1)).toEqual({ count: 1, windowStart: NOW + 1 });
    expect(await q.pruneRateLimits(db, NOW + 5000)).toBe(1);
    expect(await hit(NOW + 5001, "offer:abc")).toEqual({ count: 2, windowStart: NOW + 5000 });
  });
});

test("ulids sort by time", () => {
  expect(ulid(NOW) < ulid(NOW + 1)).toBe(true);
  expect(ulid(NOW)).not.toBe(ulid(NOW));
});
