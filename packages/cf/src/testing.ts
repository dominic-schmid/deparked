import type { ClientOptions } from "./http";
import { createCloudflareClient } from "./index";
import { createMockCloudflare, type MockSeed } from "./mock";

export const TOKEN = "test-token-never-shown";
export const ZONE = { id: "zone-1", name: "example.com" };

/** A client wired to a fresh mock, with sleeps recorded instead of waited. */
export function setup(seed: MockSeed = {}, options: Partial<ClientOptions> = {}) {
  const mock = createMockCloudflare({ token: TOKEN, zones: [ZONE], ...seed });
  const sleeps: number[] = [];
  const client = createCloudflareClient({
    token: TOKEN,
    accountId: mock.state.accountId,
    fetch: mock.fetch,
    baseUrl: "https://mock.test/client/v4",
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 1,
    ...options,
  });
  return { mock, client, sleeps };
}
