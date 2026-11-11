import { z } from "zod";
import type { Http } from "./http";

const siteSchema = z
  .object({
    site_tag: z.string(),
    site_token: z.string().optional(),
    ruleset: z.object({ zone_name: z.string().optional() }).nullish(),
  })
  .transform((site) => ({
    siteTag: site.site_tag,
    /** The beacon token baked into the lander's HTML. */
    siteToken: site.site_token,
    host: site.ruleset?.zone_name,
  }));
export type AnalyticsSite = z.infer<typeof siteSchema>;

const group = <Shape extends z.ZodRawShape>(dimensions: Shape) =>
  z.array(z.object({ sum: z.object({ visits: z.number() }), dimensions: z.object(dimensions) }));

const reportSchema = z.object({
  viewer: z.object({
    accounts: z.array(
      z.object({
        visits: group({ date: z.string(), requestHost: z.string() }),
        referrers: group({ refererHost: z.string() }),
        countries: group({ countryName: z.string() }),
      }),
    ),
  }),
});

const REPORT_QUERY = `query DeparkedVisits($accountTag: string!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      visits: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 5000, orderBy: [date_ASC]) {
        sum { visits }
        dimensions { date requestHost }
      }
      referrers: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 20, orderBy: [sum_visits_DESC]) {
        sum { visits }
        dimensions { refererHost }
      }
      countries: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 20, orderBy: [sum_visits_DESC]) {
        sum { visits }
        dimensions { countryName }
      }
    }
  }
}`;

export interface AnalyticsReport {
  visitsByDay: { date: string; host: string; visits: number }[];
  referrers: { host: string; visits: number }[];
  countries: { country: string; visits: number }[];
}

export function analyticsApi(http: Http) {
  const sites = `/accounts/${http.accountId}/rum/site_info`;
  return {
    /** One request per page of 50. */
    listSites(): Promise<AnalyticsSite[]> {
      return http.paginate({ call: "list Web Analytics sites", method: "GET", path: `${sites}/list` }, siteSchema);
    },
    /** `auto_install` stays off: the beacon is in the lander's static HTML. */
    createSite(host: string): Promise<AnalyticsSite> {
      return http.request(
        { call: "create Web Analytics site", method: "POST", path: sites, json: { host, auto_install: false } },
        siteSchema,
      );
    },
    async deleteSite(siteTag: string): Promise<void> {
      await http.request(
        { call: "delete Web Analytics site", method: "DELETE", path: `${sites}/${siteTag}` },
        z.unknown(),
      );
    },
    /** Any query against the GraphQL Analytics API. One request. */
    query<T>(query: string, variables: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
      return http.graphql("query Web Analytics", query, variables, schema);
    },
    /**
     * Visits per host and day, top referrers and top countries for the given sites, in one request.
     * `from` and `to` are inclusive dates (`YYYY-MM-DD`).
     */
    async report(input: { siteTags: string[]; from: string; to: string }): Promise<AnalyticsReport> {
      const filter = { AND: [{ date_geq: input.from, date_leq: input.to }, { siteTag_in: input.siteTags }] };
      const data = await http.graphql(
        "read Web Analytics",
        REPORT_QUERY,
        { accountTag: http.accountId, filter },
        reportSchema,
      );
      const account = data.viewer.accounts[0];
      return {
        visitsByDay: (account?.visits ?? []).map((row) => ({
          date: row.dimensions.date,
          host: row.dimensions.requestHost,
          visits: row.sum.visits,
        })),
        referrers: (account?.referrers ?? []).map((row) => ({
          host: row.dimensions.refererHost,
          visits: row.sum.visits,
        })),
        countries: (account?.countries ?? []).map((row) => ({
          country: row.dimensions.countryName,
          visits: row.sum.visits,
        })),
      };
    },
  };
}
