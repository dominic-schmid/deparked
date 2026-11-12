import type { MockCloudflare } from "@deparked/cf/mock";
import { test as base } from "@playwright/test";
import { type Stack, startStack } from "./harness/stack";

export { expect } from "@playwright/test";
export {
  TEST_ACCOUNT_ID,
  TEST_SESSION_KEY,
  TEST_TOKEN,
  TURNSTILE_DUMMY_SITEKEY,
  TURNSTILE_SECRET_NAME,
  ZONES,
} from "./harness/stack";

type SqlValue = string | number | null;

interface TestFixtures {
  /** The mock Cloudflare: seed `mock.state`, `mock.failNext(…)`, assert on `mock.calls` / `mock.callsTo(…)`. */
  mock: MockCloudflare;
  /** The local D1: `db.sql` for arranging and asserting, `db.d1` for `createDb(db.d1)` and the typed queries. */
  db: { d1: D1Database; sql<Row = Record<string, unknown>>(query: string, ...params: SqlValue[]): Promise<Row[]> };
  urls: Stack["urls"];
  hostUrl: Stack["hostUrl"];
  writeSiteFile: Stack["writeSiteFile"];
  /** Runs before every test on its own. Call it inside a test to start over half way. */
  resetState: Stack["reset"];
  cleanSlate: undefined;
}

export const test = base.extend<TestFixtures, { stack: Stack }>({
  stack: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixture's dependencies from this pattern
    async ({}, use) => {
      const stack = await startStack();
      await use(stack);
      await stack.stop();
    },
    { scope: "worker", timeout: 180_000 },
  ],
  cleanSlate: [
    async ({ stack }, use) => {
      await stack.reset();
      await use(undefined);
    },
    { auto: true },
  ],
  mock: ({ stack }, use) => use(stack.mock),
  db: ({ stack }, use) =>
    use({
      d1: stack.d1,
      sql: async <Row>(query: string, ...params: SqlValue[]) =>
        (
          await stack.d1
            .prepare(query)
            .bind(...params)
            .all<Row>()
        ).results,
    }),
  urls: ({ stack }, use) => use(stack.urls),
  hostUrl: ({ stack }, use) => use(stack.hostUrl),
  writeSiteFile: ({ stack }, use) => use(stack.writeSiteFile),
  resetState: ({ stack }, use) => use(stack.reset),
});
