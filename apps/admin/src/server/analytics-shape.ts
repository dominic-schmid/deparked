// What the analytics screens receive. No imports on purpose: routes and components import this module, and
// anything it imported would end up in the client bundle.

/** The longest range the admin shows: visits and conversion are over the last 30 days, today included. */
export const DAYS = 30;

/** Why visits are missing, in words for the owner. `credentials`: the fix is a new token in Settings. */
export type AnalyticsProblem = { message: string; credentials: boolean };

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

/**
 * Why a domain has no Web Analytics site: `off`, turned off (which deletes it); `adding`, added half-way (it is
 * created on the way); `missing`, on without one (adding the domain again creates it).
 */
export type NoSiteReason = "off" | "adding" | "missing";

export function noSiteReason(domain: { status: string; turnedOffAt: number | null }): NoSiteReason {
  if (domain.status !== "off") return "missing";
  return domain.turnedOffAt === null ? "adding" : "off";
}

/** What a domain's visits cell shows. "Unavailable" only when reading failed; never for a domain without a site. */
export type VisitsCellState =
  | { kind: "ok"; visits: HostVisits }
  | { kind: "no-visits" }
  | { kind: "unavailable" }
  | { kind: "not-set-up"; reason: NoSiteReason };

export function visitsCellState(
  domain: { host: string; noSite: NoSiteReason | null },
  visits: OverviewVisits,
): VisitsCellState {
  if (domain.noSite !== null) return { kind: "not-set-up", reason: domain.noSite };
  const own = visits.ok ? visits.byHost[domain.host] : undefined;
  if (own === undefined) return { kind: "unavailable" };
  return own.last30 === 0 ? { kind: "no-visits" } : { kind: "ok", visits: own };
}

export type DomainVisits =
  /** The domain has no Web Analytics site. */
  | { state: "not-set-up"; reason: NoSiteReason }
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
