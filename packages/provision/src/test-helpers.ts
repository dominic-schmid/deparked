// Test-only: a Cloudflare client on the in-memory mock, a migrated in-memory D1 and a ticking clock.
import { createCloudflareClient } from "@deparked/cf";
import { createMockCloudflare, type MockCloudflare, type MockSeed } from "@deparked/cf/mock";
import { createTestDb } from "@deparked/db/testing";
import type { ProvisionContext } from "./context";
import { PLAN_START, type Plan, runNextStep, type StepReport } from "./steps";

export const ZONE = { id: "zone-1", name: "example.com" };
const TOKEN = "test-token-never-shown";

export async function setup(seed: MockSeed = {}) {
  const mock = createMockCloudflare({ token: TOKEN, zones: [ZONE], ...seed });
  const cf = createCloudflareClient({
    token: TOKEN,
    accountId: mock.state.accountId,
    fetch: mock.fetch,
    baseUrl: "https://mock.test/client/v4",
    sleep: async () => {},
    random: () => 1,
  });
  // The admin Worker exists before any domain is attached: Turnstile secrets are stored on it.
  await cf.workers.uploadScript("deparked-admin", {
    mainModule: "index.js",
    modules: [{ name: "index.js", content: "export default {}" }],
    compatibilityDate: "2026-11-01",
  });
  mock.calls.length = 0;
  const { db } = await createTestDb();
  let clock = 1_700_000_000_000;
  const ctx: ProvisionContext = {
    cf,
    db,
    now: () => {
      clock += 1;
      return clock;
    },
  };
  return { mock, cf, db, ctx };
}

/** Drives a plan the way the browser does, one step per call, until it finishes, blocks or fails. */
export async function runPlan(plan: Plan): Promise<StepReport[]> {
  const reports: StepReport[] = [];
  let state = PLAN_START;
  for (;;) {
    const report = await runNextStep(plan, state);
    reports.push(report);
    state = report.state;
    if (report.finished || report.outcome === "blocked" || report.outcome === "failed") return reports;
  }
}

export function mutatingCalls(mock: MockCloudflare) {
  return mock.calls.filter((call) => call.method !== "GET");
}

/** Everything of one zone a visitor or a mail server could notice. An empty rule list equals no list. */
export function zoneSnapshot(mock: MockCloudflare, zoneId = ZONE.id) {
  const rules = (phase: string) => mock.state.rulesets.get(`${zoneId}:${phase}`)?.rules ?? [];
  return structuredClone({
    dns: mock.state.dnsRecords.get(zoneId) ?? [],
    routes: mock.state.routes.get(zoneId) ?? [],
    rewriteRules: rules("http_request_transform"),
    redirectRules: rules("http_request_dynamic_redirect"),
    emailRouting: mock.state.emailRouting.get(zoneId) === true,
    analyticsSites: mock.state.analyticsSites,
  });
}
