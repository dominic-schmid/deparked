import { defineConfig, devices } from "@playwright/test";

// `pnpm test:e2e`: local Workers on workerd plus the Cloudflare mock. No credentials, safe for CI.
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  globalSetup: "./harness/global-setup.ts",
  // One worker: the tests share one set of local Workers and one database, reset before each test.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "./playwright-report", open: "never" }]]
    : [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
