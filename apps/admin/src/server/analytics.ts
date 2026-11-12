import { type Db, getDomain, listDomains, offerStatsForHosts } from "@deparked/db";
import { type AnalyticsReport, type AnalyticsSite, type HostingAdapter, HostingError } from "@deparked/hosting";

/** The longest range the admin shows: visits and conversion are over the last 30 days, today included. */
export const DAYS = 30;
const WEEK = 7;
const DAY_MS = 86_400_000;
const TOP = 10;
/** Web Analytics lags by minutes anyway, and every read costs a subrequest. */
const CACHE_TTL_MS = 5 * 60_000;
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

/** Why visits are missing, in words for the owner. `credentials`: the fix is a new token in Settings. */
export type AnalyticsProblem = { message: string; credentials: boolean };

export interface ReportCache {
  get(key: string): AnalyticsReport | undefined;
  set(key: string, report: AnalyticsReport): void;
}

/** Reports by query, per isolate. Failures are never stored, so the next load tries Cloudflare again. */
export function createReportCache(clock: () => number = Date.now): ReportCache {
  const entries = new Map<string, { expires: number; report: AnalyticsReport }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expires > clock()) return entry.report;
      entries.delete(key);
      return undefined;
    },
    set(key, report) {
      entries.delete(key);
      entries.set(key, { expires: clock() + CACHE_TTL_MS, report });
      const oldest = entries.keys().next().value;
      if (entries.size > CACHE_ENTRIES && oldest !== undefined) entries.delete(oldest);
    },
  };
}

/** The Worker's cache. Only referenced inside server function handlers, so it stays out of the client bundle. */
export const workerReportCache = createReportCache();

export interface AnalyticsSource {
  /** May throw a `HostingError`, for example when the install has no token. */
  hosting: () => HostingAdapter;
  cache: ReportCache;
  timeoutMs?: number;
}

type ReportResult = { ok: true; report: AnalyticsReport } | { ok: false; problem: AnalyticsProblem };

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
  if (cached !== undefined) return { ok: true, report: cached };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), source.timeoutMs ?? TIMEOUT_MS);
  });
  try {
    const report = await Promise.race([source.hosting().readAnalytics({ sites, from, to }), timeout]);
    if (report === "timeout") return { ok: false, problem: UNREACHABLE };
    source.cache.set(key, report);
    return { ok: true, report };
  } catch (error) {
    return { ok: false, problem: problemOf(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Visits per day for `days`, zero where the report has none. Rows of other hosts count when `host` is null. */
function dailySeries(report: AnalyticsReport, days: string[], host: string | null): number[] {
  const byDate = new Map<string, number>();
  for (const row of report.visitsByDay) {
    if (host !== null && apex(row.host) !== host) continue;
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

export type HostVisits = {
  last7: number;
  last30: number;
  /** One entry per day of the last 30, oldest first. */
  daily: number[];
};

/**
 * Visits for the overview. Hosts without a Web Analytics site are absent from `byHost`. A failure is one
 * problem for all domains: they share one request.
 */
export type OverviewVisits =
  | { ok: true; byHost: Record<string, HostVisits> }
  | { ok: false; problem: AnalyticsProblem };

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

export type DomainVisits =
  /** The domain has no Web Analytics site yet. */
  | { state: "not-set-up" }
  | { state: "error"; problem: AnalyticsProblem }
  | {
      state: "ok";
      days: { date: string; visits: number }[];
      last7: number;
      last30: number;
      /** Most visits first, at most 10. An empty `host` is a direct visit. */
      referrers: { host: string; visits: number }[];
      countries: { country: string; visits: number }[];
    };

export type DomainAnalytics = {
  /** Offers received over the same 30 days, from the database: shown even when visits are not. */
  offers30: number;
  visits: DomainVisits;
};

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
  const daily = dailySeries(result.report, days, null);
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
