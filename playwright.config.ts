import { defineConfig, devices } from "@playwright/test";

// E2E against local Workers. The harness (local D1, Turnstile dummy keys, mock Cloudflare API) lands with the
// Foundations E2E PR; `pnpm e2e` runs it, CI runs it on every PR. Never pointed at a real account from CI.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
