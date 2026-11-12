import { z } from "zod";
import { type Http, type PageOptions, segment } from "./http";

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
  ttl: z.number().optional(),
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
    /**
     * One page of the account's zones, by name, for a picker. `contains` keeps names that contain the text.
     * Exactly one request.
     */
    async page(input: {
      contains?: string;
      page: number;
      perPage: number;
    }): Promise<{ zones: Zone[]; totalPages: number }> {
      const query: Record<string, string | number> = {
        "account.id": http.accountId,
        order: "name",
        direction: "asc",
        page: input.page,
        per_page: input.perPage,
      };
      if (input.contains !== undefined && input.contains !== "") query.name = `contains:${input.contains}`;
      const { result, totalPages } = await http.envelope(
        { call: "list zones", method: "GET", path: "/zones", query },
        z.array(zoneSchema),
      );
      return { zones: result, totalPages: totalPages ?? (result.length < input.perPage ? input.page : input.page + 1) };
    },
    get(zoneId: string): Promise<Zone> {
      return http.request({ call: "read zone", method: "GET", path: `/zones/${segment(zoneId)}` }, zoneSchema);
    },
    /** `name` matches exactly. One request per page of 100. */
    listDnsRecords(zoneId: string, filter: { type?: string; name?: string } = {}): Promise<DnsRecord[]> {
      return http.paginate(
        { call: "list DNS records", method: "GET", path: `/zones/${segment(zoneId)}/dns_records`, query: filter },
        dnsRecordSchema,
        { perPage: 100 },
      );
    },
    /**
     * Adds one record; nothing existing is touched. TTL is automatic (1) unless given. Provisioning uses it for the proxied
     * placeholder (`AAAA 100::`) a hostname without an origin needs, and to put MX records back on Turn off.
     */
    createDnsRecord(
      zoneId: string,
      record: { type: string; name: string; content: string; proxied?: boolean; priority?: number; ttl?: number },
    ): Promise<DnsRecord> {
      return http.request(
        {
          call: "create DNS record",
          method: "POST",
          path: `/zones/${segment(zoneId)}/dns_records`,
          json: { ttl: 1, ...record },
        },
        dnsRecordSchema,
      );
    },
    async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
      await http.request(
        {
          call: "delete DNS record",
          method: "DELETE",
          path: `/zones/${segment(zoneId)}/dns_records/${segment(recordId)}`,
        },
        z.unknown(),
      );
    },
    /** Cloudflare returns every route of the zone in one response. */
    listRoutes(zoneId: string): Promise<WorkerRoute[]> {
      return http.request(
        { call: "list Worker routes", method: "GET", path: `/zones/${segment(zoneId)}/workers/routes` },
        z.array(routeSchema),
      );
    },
    createRoute(zoneId: string, route: { pattern: string; script: string }): Promise<WorkerRoute> {
      return http.request(
        { call: "create Worker route", method: "POST", path: `/zones/${segment(zoneId)}/workers/routes`, json: route },
        routeSchema,
      );
    },
    /** Points an existing route at another Worker in one call. Without `script` the route runs no Worker. */
    updateRoute(zoneId: string, routeId: string, route: { pattern: string; script?: string }): Promise<WorkerRoute> {
      return http.request(
        {
          call: "update Worker route",
          method: "PUT",
          path: `/zones/${segment(zoneId)}/workers/routes/${segment(routeId)}`,
          json: route,
        },
        routeSchema,
      );
    },
    async deleteRoute(zoneId: string, routeId: string): Promise<void> {
      await http.request(
        {
          call: "delete Worker route",
          method: "DELETE",
          path: `/zones/${segment(zoneId)}/workers/routes/${segment(routeId)}`,
        },
        z.unknown(),
      );
    },
  };
}
