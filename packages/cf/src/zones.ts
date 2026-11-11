import { z } from "zod";
import type { Http, PageOptions } from "./http";

const accountSchema = z.object({ id: z.string(), name: z.string() });
export type Account = z.infer<typeof accountSchema>;

const zoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().optional(),
  account: z.object({ id: z.string().optional() }).optional(),
});
export type Zone = z.infer<typeof zoneSchema>;

const dnsRecordSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  content: z.string().optional(),
  priority: z.number().optional(),
  proxied: z.boolean().optional(),
});
export type DnsRecord = z.infer<typeof dnsRecordSchema>;

const routeSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  script: z.string().optional(),
});
export type WorkerRoute = z.infer<typeof routeSchema>;

export function accountsApi(http: Http) {
  const account = `/accounts/${http.accountId}`;
  return {
    get(): Promise<Account> {
      return http.request({ call: "read account", method: "GET", path: account }, accountSchema);
    },
    /** The `<name>` in `<worker>.<name>.workers.dev`, or null when the account has none yet. */
    async workersSubdomain(): Promise<string | null> {
      const result = await http.requestOrNull(
        { call: "read workers.dev subdomain", method: "GET", path: `${account}/workers/subdomain` },
        z.object({ subdomain: z.string().nullable() }),
      );
      return result?.subdomain ?? null;
    },
  };
}

export function zonesApi(http: Http) {
  return {
    /** Zones of this account. One request per page of 50. */
    list(filter: { name?: string } = {}, page?: PageOptions): Promise<Zone[]> {
      return http.paginate(
        { call: "list zones", method: "GET", path: "/zones", query: { "account.id": http.accountId, ...filter } },
        zoneSchema,
        page,
      );
    },
    get(zoneId: string): Promise<Zone> {
      return http.request({ call: "read zone", method: "GET", path: `/zones/${zoneId}` }, zoneSchema);
    },
    /** Read only. `name` matches exactly. One request per page of 100. */
    listDnsRecords(zoneId: string, filter: { type?: string; name?: string } = {}): Promise<DnsRecord[]> {
      return http.paginate(
        { call: "list DNS records", method: "GET", path: `/zones/${zoneId}/dns_records`, query: filter },
        dnsRecordSchema,
        { perPage: 100 },
      );
    },
    /** Cloudflare returns every route of the zone in one response. */
    listRoutes(zoneId: string): Promise<WorkerRoute[]> {
      return http.request(
        { call: "list Worker routes", method: "GET", path: `/zones/${zoneId}/workers/routes` },
        z.array(routeSchema),
      );
    },
    createRoute(zoneId: string, route: { pattern: string; script: string }): Promise<WorkerRoute> {
      return http.request(
        { call: "create Worker route", method: "POST", path: `/zones/${zoneId}/workers/routes`, json: route },
        routeSchema,
      );
    },
    async deleteRoute(zoneId: string, routeId: string): Promise<void> {
      await http.request(
        { call: "delete Worker route", method: "DELETE", path: `/zones/${zoneId}/workers/routes/${routeId}` },
        z.unknown(),
      );
    },
  };
}
