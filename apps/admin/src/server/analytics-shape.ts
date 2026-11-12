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
