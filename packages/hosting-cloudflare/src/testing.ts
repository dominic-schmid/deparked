// Test-only: a Cloudflare account on the in-memory mock, for tests of code that drives `createCloudflareDomainSetup`.
import { createCloudflareClient } from "@deparked/cf";
import { createMockCloudflare, type MockSeed } from "@deparked/cf/mock";

const TOKEN = "mock-token-never-shown";

/**
 * A mock account with the admin Worker already deployed (bot-check secrets are stored on it). `connection` goes
 * into `createCloudflareDomainSetup`; `mock` is for arranging and asserting.
 */
export async function createMockAccount(seed: MockSeed = {}) {
  const mock = createMockCloudflare({ token: TOKEN, ...seed });
  const connection = {
    token: TOKEN,
    accountId: mock.state.accountId,
    baseUrl: "https://mock.test/client/v4",
    fetch: mock.fetch,
    sleep: async () => {},
  };
  await createCloudflareClient(connection).workers.uploadScript("deparked-admin", {
    mainModule: "index.js",
    modules: [{ name: "index.js", content: "export default {}" }],
    compatibilityDate: "2026-11-01",
  });
  mock.calls.length = 0;
  return { mock, connection };
}
