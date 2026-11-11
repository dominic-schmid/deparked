import { describe, expect, test } from "vitest";
import type { Db } from "./client";
import * as queries from "./queries/index";
import { HOST, NOTIFY, NOW, SITEKEY, seed } from "./test-seed";
import { createTestDb, type ExecutedStatement } from "./testing";

type Queries = typeof queries;
type Args<K extends keyof Queries> = Parameters<Queries[K]> extends [Db, ...infer Rest] ? Rest : never;

// One or more argument lists for EVERY exported query; a query without an entry fails to compile and fails the
// test. Add a list per shape of SQL the function can produce (optional filters, null hosts).
const SAMPLES: { [K in keyof Queries]: Args<K>[] } = {
  getWorkspace: [[]],
  initWorkspace: [[{ now: NOW }]],
  updateWorkspace: [[{ patch: { installedRelease: "1.0.0" }, now: NOW }]],
  setSetupSecret: [[{ secretHash: "hash", expiresAt: NOW + 1, now: NOW }]],
  consumeSetupSecret: [[{ secretHash: "hash", passwordHash: "p", passwordSalt: "s", passwordIterations: 1, now: NOW }]],
  setPassword: [[{ passwordHash: "p", passwordSalt: "s", passwordIterations: 1, now: NOW }]],
  bumpSessionVersion: [[NOW]],
  getInstallState: [[]],
  initInstallState: [[]],
  updateInstallState: [[{ step: "download", stepStatus: "running" }]],

  listDomains: [[], [{ includeRemoved: true }]],
  getDomain: [[HOST]],
  insertDomain: [[{ domain: { host: "other.example", zoneId: "zone-2" }, now: NOW }]],
  updateDomain: [[{ host: HOST, patch: { analyticsSiteTag: "tag" }, now: NOW }]],
  setDomainStatus: [[{ host: HOST, status: "off", now: NOW }]],
  getOfferTarget: [[HOST]],

  getConfig: [[HOST]],
  saveDraft: [[{ host: HOST, json: "{}", schemaVersion: 1, now: NOW }]],
  publishConfig: [[{ host: HOST, json: "{}", schemaVersion: 1, release: "1.0.0", now: NOW }]],
  listConfigHistory: [[{ host: HOST }]],
  getConfigHistoryEntry: [[1]],

  insertOffer: [
    [{ offer: { host: HOST, amountMinor: 100, currency: "USD", name: "Buyer", email: "buyer@example.com" }, now: NOW }],
  ],
  getOffer: [["01"]],
  listOffers: [
    [],
    [{ host: HOST }],
    [{ status: "new" }],
    [{ host: HOST, status: "new", before: { createdAt: NOW, id: "01" }, limit: 10 }],
  ],
  setOfferStatus: [[{ id: "01", status: "replied", now: NOW }]],
  setOfferEmailStatus: [[{ id: "01", emailStatus: "sent", notifiedTo: NOTIFY, now: NOW }]],
  countNewOffers: [[], [HOST]],
  offerStatsForHosts: [[[HOST, "other.example"]]],

  listNotifyAddresses: [[]],
  getNotifyAddress: [[NOTIFY]],
  insertNotifyAddress: [[{ email: "second@example.com", now: NOW }]],
  updateNotifyAddress: [[{ email: NOTIFY, patch: { lastResentAt: NOW } }]],
  deleteNotifyAddress: [[NOTIFY]],

  listTurnstileWidgets: [[]],
  insertTurnstileWidget: [[{ sitekey: "2x00000000000000000000AB", name: "deparked-2", secretName: "S2", now: NOW }]],
  findTurnstileWidgetWithFreeSlot: [[]],
  claimTurnstileSlot: [[SITEKEY]],
  releaseTurnstileSlot: [[SITEKEY]],

  listSiteFiles: [[]],
  listSiteFilesByHost: [[HOST], [null]],
  replaceSiteFiles: [
    [
      {
        host: HOST,
        files: [{ path: `/sites/${HOST}/index.html`, hash: "h", size: 1, contentType: "text/html" }],
        now: NOW,
      },
    ],
    [{ host: null, files: [{ path: "/catalog/a.woff2", hash: "h", size: 1, contentType: "font/woff2" }], now: NOW }],
  ],
  deleteSiteFilesByHost: [[HOST], [null]],

  insertDeployment: [[{ worker: "sites", kind: "publish", host: HOST, now: NOW }]],
  finishDeployment: [[{ id: 1, status: "done", cfVersionId: "v", now: NOW }]],
  getDeployment: [[1]],
  listDeployments: [[{ worker: "sites" }], [{ worker: "sites", status: "done" }]],
  latestDeployment: [[{ worker: "admin" }]],
  getPublishLock: [[]],
  acquirePublishLock: [[{ deploymentId: 1, ttlMs: 60_000, now: NOW }]],
  releasePublishLock: [[1]],

  insertLedgerEntry: [[{ host: HOST, zoneId: "zone-1", resource: "route", cfId: "r1", action: "created", now: NOW }]],
  listLedger: [[{ host: HOST }], [{ host: null, activeOnly: true }]],
  markLedgerUndone: [[{ id: 1, now: NOW }]],

  hitRateLimit: [[{ key: "login:abc", windowMs: 60_000, now: NOW }]],
  clearRateLimit: [["login:abc"]],
  pruneRateLimits: [[NOW]],
};

// At most one row each, by a CHECK constraint.
const SINGLE_ROW_TABLES = ["workspace", "install_state", "publish_lock"];

// Queries whose job is to read a whole table that is small by a hard outside limit. Nothing else may scan.
const FULL_READS: Partial<Record<keyof Queries, string>> = {
  listDomains: "domains", // about 200: 20 Turnstile widgets x 10 hostnames
  listNotifyAddresses: "notify_addresses", // 200 Email Routing destination addresses per account
  listTurnstileWidgets: "turnstile_widgets", // 20 widgets on the free plan
  listSiteFiles: "site_files", // the publish manifest is sent whole on every publish
};

/** The tables a statement reads from start to end ("SCAN x"), according to SQLite's planner. */
function scannedTables(sqlite: Awaited<ReturnType<typeof createTestDb>>["sqlite"], statement: ExecutedStatement) {
  const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).all(...(statement.params as never[]));
  return plan
    .map((step) => /^SCAN (\S+)/.exec(String(step.detail))?.[1])
    .filter((table) => table !== undefined && table !== "CONSTANT");
}

test("the check sees a full table scan", async () => {
  const { sqlite } = await createTestDb();
  expect(scannedTables(sqlite, { sql: "SELECT * FROM offers WHERE email = ?", params: ["a"] })).toEqual(["offers"]);
  expect(scannedTables(sqlite, { sql: "SELECT * FROM offers ORDER BY created_at", params: [] })).toEqual(["offers"]);
  expect(scannedTables(sqlite, { sql: "SELECT * FROM offers WHERE host = ?", params: ["a"] })).toEqual([]);
});

describe("every query uses an index", () => {
  test.each(Object.entries(queries))("%s", async (name, query) => {
    const samples: unknown[][] = SAMPLES[name as keyof Queries] ?? [];
    expect(samples.length, `add ${name} to SAMPLES`).toBeGreaterThan(0);
    const allowed = [...SINGLE_ROW_TABLES, FULL_READS[name as keyof Queries]];

    for (const args of samples) {
      const { db, sqlite, executed } = await createTestDb();
      await seed(db);
      await queries.insertDeployment(db, { worker: "sites", kind: "publish", now: NOW });
      executed.length = 0;

      await (query as (db: Db, ...args: unknown[]) => Promise<unknown>)(db, ...args);

      expect(executed.length, `${name} ran no SQL`).toBeGreaterThan(0);
      for (const statement of executed) {
        const scans = scannedTables(sqlite, statement).filter((table) => !allowed.includes(table));
        expect(scans, `${name} scans a table:\n${statement.sql}`).toEqual([]);
      }
    }
  });
});
