import { defineConfig } from "@playwright/test";

// The lander gates: every registered variant's layout at 25 viewports, the offer form with and without JavaScript.
// Pages are rendered in the test process and served by request interception: no server, no network.
export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  outputDir: "../../test-results/lander",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 120_000,
  use: { browserName: "chromium", reducedMotion: "reduce" },
});
