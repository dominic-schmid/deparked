import type { MockCloudflare } from "@deparked/cf/mock";
import { createDb, initWorkspace, setPassword } from "@deparked/db";
import { test as base, type Page } from "@playwright/test";
import { hashPassword } from "../apps/admin/src/server/auth/password";
import { type Stack, startStack, TEST_PASSWORD } from "./harness/stack";

export { expect } from "@playwright/test";
export {
  TEST_ACCOUNT_ID,
  TEST_PASSWORD,
  TEST_RELEASE,
  TEST_RELEASE_NEXT,
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
  sentMail: Stack["sentMail"];
  /** The SHA-256 of each built release's release.json, by version. */
  releases: Stack["releases"];
  /** What the admin finds as the newest release on "GitHub". None until set; reset before every test. */
  setLatestRelease: Stack["setLatestRelease"];
  /** Runs before every test on its own. Call it inside a test to start over half way. */
  resetState: Stack["reset"];
  /**
   * Stores `TEST_PASSWORD` as the workspace password in D1 (setup done), logs in through the login form and
   * returns the page on `/admin`. With a host the login happens on that managed domain, otherwise on the
   * admin's own address. Logins do not carry over between the two, as in production.
   */
  login(host?: string): Promise<Page>;
  cleanSlate: undefined;
}

/**
 * Waits until the admin page has hydrated. Its controls are disabled until then, so Playwright's own waiting covers
 * every fill and click; this is for checks that read the page without acting on it.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
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
  login: ({ stack, page }, use) =>
    use(async (host) => {
      const db = createDb(stack.d1);
      const now = Date.now();
      const password = await hashPassword(TEST_PASSWORD);
      await initWorkspace(db, { now });
      await setPassword(db, {
        passwordHash: password.hash,
        passwordSalt: password.salt,
        passwordIterations: password.iterations,
        now,
      });
      const admin = (path: string) => (host === undefined ? `${stack.urls.admin}${path}` : stack.hostUrl(host, path));
      await page.goto(admin("/admin/login"));
      await page.getByLabel("Password").fill(TEST_PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL(admin("/admin"));
      await waitForHydration(page);
      return page;
    }),
  urls: ({ stack }, use) => use(stack.urls),
  hostUrl: ({ stack }, use) => use(stack.hostUrl),
  writeSiteFile: ({ stack }, use) => use(stack.writeSiteFile),
  sentMail: ({ stack }, use) => use(stack.sentMail),
  releases: ({ stack }, use) => use(stack.releases),
  setLatestRelease: ({ stack }, use) => use(stack.setLatestRelease),
  resetState: ({ stack }, use) => use(stack.reset),
});
