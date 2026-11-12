import { type Db, getDomain, listDomains, offerStatsForHosts } from "@deparked/db";
import { type AnalyticsReport, type AnalyticsSite, type HostingAdapter, HostingError } from "@deparked/hosting";
import {
  type AnalyticsProblem,
  DAYS,
  type DomainAnalytics,
  type HostVisits,
  type OverviewVisits,
} from "./analytics-shape";

const WEEK = 7;
const DAY_MS = 86_400_000;
const TOP = 10;
/** Web Analytics lags by minutes anyway, and every read costs a subrequest. */
const CACHE_TTL_MS = 5 * 60_000;
/** After a timeout the next loads answer at once instead of waiting on Cloudflare again. */
const TIMEOUT_TTL_MS = 30_000;
const CACHE_ENTRIES = 32;
/** The page renders without visits rather than wait on a slow Cloudflare (each attempt alone may take 10 s). */
const TIMEOUT_MS = 5_000;

/** The last `days` UTC dates (`YYYY-MM-DD`), oldest first, ending with today. */
export function lastDays(now: number, days = DAYS): string[] {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return Array.from({ length: days }, (_, index) =>
    new Date(today - (days - 1 - index) * DAY_MS).toISOString().slice(0, 10),
  );
}

/** The start of the oldest day `lastDays` covers, for counting offers over the same range. */
export function rangeStart(now: number, days = DAYS): number {
  return (Math.floor(now / DAY_MS) - (days - 1)) * DAY_MS;
}

type ReportResult = { ok: true; report: AnalyticsReport } | { ok: false; problem: AnalyticsProblem };

export interface ReportCache {
  get(key: string): ReportResult | undefined;
  set(key: string, result: ReportResult, ttlMs: number): void;
}

/** Results by query, per isolate: reports for five minutes, a timeout for 30 s, other failures not at all. */
export function createReportCache(clock: () => number = Date.now): ReportCache {
  const entries = new Map<string, { expires: number; result: ReportResult }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expires > clock()) return entry.result;
      entries.delete(key);
      return undefined;
    },
    set(key, result, ttlMs) {
      entries.delete(key);
      entries.set(key, { expires: clock() + ttlMs, result });
      const oldest = entries.keys().next().value;
      if (entries.size > CACHE_ENTRIES && oldest !== undefined) entries.delete(oldest);
    },
  };
}

/** The Worker's cache, one per isolate. This module is server-only: the client imports `analytics-shape`. */
export const workerReportCache = createReportCache();

export interface AnalyticsSource {
  /** May throw a `HostingError`, for example when the install has no token. */
  hosting: () => HostingAdapter;
  cache: ReportCache;
  timeoutMs?: number;
}

const UNREACHABLE: AnalyticsProblem = {
  message: "Cloudflare did not answer in time. Visits show again once it does.",
  credentials: false,
};

function problemOf(error: unknown): AnalyticsProblem {
  if (!(error instanceof HostingError)) {
    return { message: "Visits could not be read from Cloudflare. Try again later.", credentials: false };
  }
  if (error.retryable) return UNREACHABLE;
  return { message: error.message, credentials: error.credentialsRejected };
}

async function readReport(source: AnalyticsSource, sites: AnalyticsSite[], days: string[]): Promise<ReportResult> {
  const from = days[0] ?? "";
  const to = days.at(-1) ?? "";
  const key = `${from}|${to}|${sites
    .map((site) => site.siteId)
    .sort()
    .join(",")}`;
  const cached = source.cache.get(key);
  if (cached !== undefined) return cached;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), source.timeoutMs ?? TIMEOUT_MS);
  });
  try {
    const report = await Promise.race([source.hosting().readAnalytics({ sites, from, to }), timeout]);
    const result: ReportResult = report === "timeout" ? { ok: false, problem: UNREACHABLE } : { ok: true, report };
    source.cache.set(key, result, result.ok ? CACHE_TTL_MS : TIMEOUT_TTL_MS);
    return result;
  } catch (error) {
    return { ok: false, problem: problemOf(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A domain's visits per day for `days`, zero where the report has none. Both screens count through this, so
 * they agree: a row is the domain's when its host is the domain's, with or without `www.`. The overview reads
 * all sites in one report whose rows name only the host, so the host is the only way to tell them apart.
 */
function dailySeries(report: AnalyticsReport, days: string[], host: string): number[] {
  const own = apex(host);
  const byDate = new Map<string, number>();
  for (const row of report.visitsByDay) {
    if (apex(row.host) !== own) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.visits);
  }
  return days.map((date) => byDate.get(date) ?? 0);
}

/** `www.example.com` redirects to `example.com`, so its visits are the domain's. */
function apex(host: string): string {
  const lower = host.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export async function loadOverviewVisits(db: Db, source: AnalyticsSource, now: number): Promise<OverviewVisits> {
  const domains = (await listDomains(db)).filter((domain) => domain.analyticsSiteTag !== null);
  if (domains.length === 0) return { ok: true, byHost: {} };
  const days = lastDays(now);
  const result = await readReport(
    source,
    domains.map((domain) => ({ host: domain.host, siteId: domain.analyticsSiteTag ?? "" })),
    days,
  );
  if (!result.ok) return result;
  const byHost: Record<string, HostVisits> = {};
  for (const domain of domains) {
    const daily = dailySeries(result.report, days, domain.host);
    byHost[domain.host] = { last7: sum(daily.slice(-WEEK)), last30: sum(daily), daily };
  }
  return { ok: true, byHost };
}

/** Null for a host that is not managed. */
export async function loadDomainAnalytics(
  db: Db,
  source: AnalyticsSource,
  host: string,
  now: number,
): Promise<DomainAnalytics | null> {
  const domain = await getDomain(db, host);
  if (domain === undefined || domain.status === "removed") return null;
  const [stats] = await offerStatsForHosts(db, [host], rangeStart(now));
  const offers30 = stats?.recentCount ?? 0;
  if (domain.analyticsSiteTag === null) return { offers30, visits: { state: "not-set-up" } };

  const days = lastDays(now);
  const result = await readReport(source, [{ host, siteId: domain.analyticsSiteTag }], days);
  if (!result.ok) return { offers30, visits: { state: "error", problem: result.problem } };
  const daily = dailySeries(result.report, days, host);
  return {
    offers30,
    visits: {
      state: "ok",
      days: days.map((date, index) => ({ date, visits: daily[index] ?? 0 })),
      last7: sum(daily.slice(-WEEK)),
      last30: sum(daily),
      referrers: result.report.referrers.slice(0, TOP),
      countries: result.report.countries.slice(0, TOP),
    },
  };
}
