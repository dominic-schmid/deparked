import { insertDomain, insertOffer, updateDomain } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { HostingError } from "@deparked/hosting";
import { createFakeHosting, type FakeAnalyticsRow } from "@deparked/hosting/testing";
import { describe, expect, test } from "vitest";
import {
  type AnalyticsSource,
  createReportCache,
  lastDays,
  loadDomainAnalytics,
  loadOverviewVisits,
} from "./analytics";
import { noSiteReason, type OverviewVisits, visitsCellState } from "./analytics-shape";
import { HOST, NOW, seed } from "./test-seed";

const DAY = 86_400_000;
const days = lastDays(NOW);
const today = days.at(-1) ?? "";
const daysAgo = (count: number) => days[days.length - 1 - count] ?? "";

function row(input: Partial<FakeAnalyticsRow> & Pick<FakeAnalyticsRow, "date" | "visits">): FakeAnalyticsRow {
  return { siteId: "site-1", host: HOST, referrer: "", country: "Germany", ...input };
}

async function setup() {
  const { db } = await createTestDb();
  await seed(db);
  await updateDomain(db, { host: HOST, patch: { analyticsSiteTag: "site-1" }, now: NOW });
  const hosting = createFakeHosting();
  let clock = NOW;
  const source: AnalyticsSource = {
    hosting: () => hosting,
    cache: createReportCache(() => clock),
  };
  return { db, hosting, source, tick: (ms: number) => (clock += ms) };
}

test("the range is the last 30 UTC days, today included", () => {
  expect(days).toHaveLength(30);
  expect(today).toBe(new Date(NOW).toISOString().slice(0, 10));
  expect(daysAgo(29)).toBe(new Date(NOW - 29 * DAY).toISOString().slice(0, 10));
});

describe("overview visits", () => {
  test("counts 7 and 30 days per domain with a daily series, www included, other sites and old days not", async () => {
    const { db, hosting, source } = await setup();
    await insertDomain(db, { domain: { host: "other.example", zoneId: "z", analyticsSiteTag: "site-2" }, now: NOW });
    await insertDomain(db, { domain: { host: "plain.example", zoneId: "z" }, now: NOW });
    hosting.analytics.push(
      row({ date: today, visits: 4 }),
      row({ date: today, host: "www.example.com", visits: 1 }),
      row({ date: daysAgo(6), visits: 2 }),
      row({ date: daysAgo(7), visits: 10 }),
      row({ date: daysAgo(30), visits: 1_000 }),
      row({ siteId: "site-2", host: "other.example", date: daysAgo(1), visits: 3 }),
      row({ siteId: "unrelated", host: "unrelated.example", date: today, visits: 99 }),
    );

    const visits = await loadOverviewVisits(db, source, NOW);

    if (!visits.ok) throw new Error("expected visits");
    expect(Object.keys(visits.byHost).sort()).toEqual([HOST, "other.example"]);
    expect(visits.byHost[HOST]).toMatchObject({ last7: 7, last30: 17 });
    expect(visits.byHost[HOST]?.daily).toHaveLength(30);
    expect(visits.byHost[HOST]?.daily.at(-1)).toBe(5);
    expect(visits.byHost[HOST]?.daily.at(-8)).toBe(10);
    expect(visits.byHost["other.example"]).toMatchObject({ last7: 3, last30: 3 });
  });

  test("makes no request when no domain has analytics", async () => {
    const { db, hosting } = await setup();
    await updateDomain(db, { host: HOST, patch: { analyticsSiteTag: null }, now: NOW });
    const source: AnalyticsSource = {
      hosting: () => {
        throw new Error("must not be called");
      },
      cache: createReportCache(),
    };
    expect(await loadOverviewVisits(db, source, NOW)).toEqual({ ok: true, byHost: {} });
    expect(hosting.analytics).toEqual([]);
  });

  test("reads Cloudflare once per five minutes for the same range", async () => {
    const { db, hosting, source, tick } = await setup();
    hosting.analytics.push(row({ date: today, visits: 1 }));
    await loadOverviewVisits(db, source, NOW);
    hosting.analytics.push(row({ date: today, visits: 1 }));
    expect(await loadOverviewVisits(db, source, NOW)).toMatchObject({ ok: true, byHost: { [HOST]: { last7: 1 } } });
    tick(5 * 60_000);
    expect(await loadOverviewVisits(db, source, NOW)).toMatchObject({ ok: true, byHost: { [HOST]: { last7: 2 } } });
  });

  test("a rejected token is a problem with the fix in Settings, and is not cached", async () => {
    const { db, hosting, source } = await setup();
    hosting.rejectCredentials("readAnalytics");
    expect(await loadOverviewVisits(db, source, NOW)).toEqual({
      ok: false,
      problem: { message: "The saved token was rejected. Replace it in Settings.", credentials: true },
    });
    expect(await loadOverviewVisits(db, source, NOW)).toMatchObject({ ok: true });
  });

  test("no stored token is a problem, not a crash", async () => {
    const { db, source } = await setup();
    const noToken: AnalyticsSource = {
      ...source,
      hosting: () => {
        throw new HostingError("credentials-rejected", "No Cloudflare token is stored for this install.");
      },
    };
    expect(await loadOverviewVisits(db, noToken, NOW)).toEqual({
      ok: false,
      problem: { message: "No Cloudflare token is stored for this install.", credentials: true },
    });
  });

  test("Cloudflare failing, or slower than the timeout, reads as not answering", async () => {
    const { db, hosting, source } = await setup();
    hosting.failNext("readAnalytics", new HostingError("unavailable", "Cloudflare answered 503 (read Web Analytics)."));
    const failing = await loadOverviewVisits(db, source, NOW);
    expect(failing).toEqual({
      ok: false,
      problem: { message: "Cloudflare did not answer in time. Visits show again once it does.", credentials: false },
    });
  });

  test("a timeout is remembered for 30 s, so the next loads do not wait on Cloudflare again", async () => {
    const { db, hosting, source, tick } = await setup();
    hosting.analytics.push(row({ date: today, visits: 1 }));
    let reads = 0;
    let hang = true;
    const slow: AnalyticsSource = {
      ...source,
      timeoutMs: 10,
      hosting: () => ({
        ...hosting,
        readAnalytics: (query) => {
          reads += 1;
          return hang ? new Promise(() => {}) : hosting.readAnalytics(query);
        },
      }),
    };
    const timedOut = {
      ok: false,
      problem: { message: "Cloudflare did not answer in time. Visits show again once it does.", credentials: false },
    };
    expect(await loadOverviewVisits(db, slow, NOW)).toEqual(timedOut);
    hang = false;
    tick(29_000);
    expect(await loadOverviewVisits(db, slow, NOW)).toEqual(timedOut);
    expect(reads).toBe(1);
    tick(1_000);
    expect(await loadOverviewVisits(db, slow, NOW)).toMatchObject({ ok: true, byHost: { [HOST]: { last7: 1 } } });
    expect(reads).toBe(2);
  });

  test("an unexpected error is a plain-words problem", async () => {
    const { db, hosting, source } = await setup();
    hosting.failNext("readAnalytics", new Error("boom"));
    expect(await loadOverviewVisits(db, source, NOW)).toEqual({
      ok: false,
      problem: { message: "Visits could not be read from Cloudflare. Try again later.", credentials: false },
    });
  });
});

test("the overview and the domain count the same rows, www and other hosts of a shared site included", async () => {
  const { db, hosting, source } = await setup();
  await insertDomain(db, { domain: { host: "www.shop.example", zoneId: "z", analyticsSiteTag: "site-1" }, now: NOW });
  hosting.analytics.push(
    row({ date: today, visits: 4 }),
    row({ date: today, host: "WWW.Example.com", visits: 1 }),
    row({ date: today, host: "shop.example", visits: 2 }),
    row({ date: today, host: "www.shop.example", visits: 3 }),
    row({ date: today, host: "preview.example.net", visits: 50 }),
  );

  const overview = await loadOverviewVisits(db, source, NOW);
  if (!overview.ok) throw new Error("expected visits");
  for (const [host, expected] of [
    [HOST, 5],
    ["www.shop.example", 5],
  ] as const) {
    const detail = await loadDomainAnalytics(db, source, host, NOW);
    if (detail?.visits.state !== "ok") throw new Error("expected visits");
    expect(overview.byHost[host]).toMatchObject({ last7: expected, last30: expected });
    expect(detail.visits).toMatchObject({ last7: expected, last30: expected });
  }
});

describe("domain analytics", () => {
  test("shows daily visits, referrers, countries and the offers of the same 30 days", async () => {
    const { db, hosting, source } = await setup();
    const buyer = { host: HOST, currency: "EUR", name: "Buyer", email: "buyer@example.com", amountMinor: 100 };
    await insertOffer(db, { offer: buyer, now: NOW });
    await insertOffer(db, { offer: buyer, now: NOW - 29 * DAY });
    await insertOffer(db, { offer: buyer, now: NOW - 31 * DAY });
    hosting.analytics.push(
      row({ date: today, visits: 6, referrer: "news.example", country: "Austria" }),
      row({ date: daysAgo(10), visits: 4 }),
      row({ date: daysAgo(10), host: "www.example.com", visits: 1 }),
    );

    const analytics = await loadDomainAnalytics(db, source, HOST, NOW);

    expect(analytics?.offers30).toBe(2);
    const visits = analytics?.visits;
    if (visits?.state !== "ok") throw new Error("expected visits");
    expect(visits).toMatchObject({ last7: 6, last30: 11 });
    expect(visits.days).toHaveLength(30);
    expect(visits.days.at(-1)).toEqual({ date: today, visits: 6 });
    expect(visits.days.at(-11)).toEqual({ date: daysAgo(10), visits: 5 });
    expect(visits.referrers).toEqual([
      { host: "news.example", visits: 6 },
      { host: "", visits: 5 },
    ]);
    expect(visits.countries).toEqual([
      { country: "Austria", visits: 6 },
      { country: "Germany", visits: 5 },
    ]);
  });

  test("keeps at most ten referrers and countries", async () => {
    const { db, hosting, source } = await setup();
    for (let index = 0; index < 15; index++) {
      hosting.analytics.push(row({ date: today, visits: 1, referrer: `r${index}.example`, country: `C${index}` }));
    }
    const analytics = await loadDomainAnalytics(db, source, HOST, NOW);
    if (analytics?.visits.state !== "ok") throw new Error("expected visits");
    expect(analytics.visits.referrers).toHaveLength(10);
    expect(analytics.visits.countries).toHaveLength(10);
  });

  test("a domain without a Web Analytics site says so and still counts offers", async () => {
    const { db, source } = await setup();
    await updateDomain(db, { host: HOST, patch: { analyticsSiteTag: null }, now: NOW });
    await insertOffer(db, {
      offer: { host: HOST, currency: "EUR", name: "Buyer", email: "buyer@example.com", amountMinor: 1 },
      now: NOW,
    });
    expect(await loadDomainAnalytics(db, source, HOST, NOW)).toEqual({
      offers30: 1,
      visits: { state: "not-set-up", reason: "missing" },
    });
  });

  test("a failure keeps the offers and explains the visits", async () => {
    const { db, hosting, source } = await setup();
    hosting.rejectCredentials("readAnalytics");
    expect(await loadDomainAnalytics(db, source, HOST, NOW)).toEqual({
      offers30: 0,
      visits: {
        state: "error",
        problem: { message: "The saved token was rejected. Replace it in Settings.", credentials: true },
      },
    });
  });

  test("an unmanaged or removed host has none", async () => {
    const { db, source } = await setup();
    await insertDomain(db, { domain: { host: "gone.example", zoneId: "z", status: "removed" }, now: NOW });
    expect(await loadDomainAnalytics(db, source, "unknown.example", NOW)).toBeNull();
    expect(await loadDomainAnalytics(db, source, "gone.example", NOW)).toBeNull();
  });
});

describe("what a domain's visits cell says", () => {
  const ok = (last30: number): OverviewVisits => ({
    ok: true,
    byHost: { [HOST]: { last7: last30, last30, daily: [last30] } },
  });
  const failed: OverviewVisits = { ok: false, problem: { message: "Down", credentials: false } };

  test("a domain without a site is not set up, with the reason, even when reading failed", () => {
    expect(visitsCellState({ host: HOST, noSite: "missing" }, failed)).toEqual({
      kind: "not-set-up",
      reason: "missing",
    });
    expect(visitsCellState({ host: HOST, noSite: "off" }, ok(3))).toEqual({ kind: "not-set-up", reason: "off" });
  });

  test("unavailable only when the read failed", () => {
    expect(visitsCellState({ host: HOST, noSite: null }, failed)).toEqual({ kind: "unavailable" });
  });

  test("a new domain without visits has none yet, and one with visits shows them", () => {
    expect(visitsCellState({ host: HOST, noSite: null }, ok(0))).toEqual({ kind: "no-visits" });
    expect(visitsCellState({ host: HOST, noSite: null }, ok(12))).toMatchObject({ kind: "ok" });
  });

  test("why a site is missing follows the domain's state", () => {
    expect(noSiteReason({ status: "live", turnedOffAt: null })).toBe("missing");
    expect(noSiteReason({ status: "off", turnedOffAt: null })).toBe("adding");
    expect(noSiteReason({ status: "off", turnedOffAt: NOW })).toBe("off");
  });
});
