import { z } from "zod";
import type { Http } from "./http";

const databaseSchema = z.object({ uuid: z.string(), name: z.string() });
export type D1Database = z.infer<typeof databaseSchema>;

const statementResultSchema = z.object({
  success: z.boolean().optional(),
  results: z
    .array(z.record(z.string(), z.unknown()))
    .nullish()
    .transform((rows) => rows ?? []),
});
export type D1StatementResult = z.infer<typeof statementResultSchema>;

export function d1Api(http: Http) {
  const base = `/accounts/${http.accountId}/d1/database`;
  return {
    /** `name` filters by database name. One request per page of 50. */
    list(filter: { name?: string } = {}): Promise<D1Database[]> {
      return http.paginate({ call: "list D1 databases", method: "GET", path: base, query: filter }, databaseSchema);
    },
    create(name: string): Promise<D1Database> {
      return http.request({ call: "create D1 database", method: "POST", path: base, json: { name } }, databaseSchema);
    },
    /**
     * Runs SQL through the HTTP API (migrations, the ownership check). `sql` may hold several statements
     * separated by `;`; one result comes back per statement. `params` bind to a single statement.
     */
    query(databaseId: string, sql: string, params: string[] = []): Promise<D1StatementResult[]> {
      const json = params.length === 0 ? { sql } : { sql, params };
      return http.request(
        { call: "run D1 query", method: "POST", path: `${base}/${databaseId}/query`, json },
        z.array(statementResultSchema),
      );
    },
  };
}
