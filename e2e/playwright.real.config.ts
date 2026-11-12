import { defineConfig, devices } from "@playwright/test";

// `pnpm test:e2e:real`: the same journeys against the owner's real Cloudflare account, on `deparked-test-*`
// resources and throwaway subdomains, torn down after. Never in CI. The suite itself arrives with DOM-370;
// until then this only checks that a run was asked for on purpose.
const NEEDED = {
  DEPARKED_E2E_REAL: "set to 1 to confirm you mean the real account",
  DEPARKED_E2E_ACCOUNT_ID: "the Cloudflare account to test in",
  DEPARKED_E2E_ZONE: "an existing zone in that account; tests use throwaway subdomains of it",
  DEPARKED_E2E_TOKEN: "an API token for that account with the permissions the installer asks for",
};

const missing = Object.keys(NEEDED).filter((name) => (process.env[name] ?? "") === "");
const problems = [
  ...(process.env.CI !== undefined || process.env.GITHUB_ACTIONS !== undefined
    ? ["CI or GITHUB_ACTIONS is set: the real-account suite never runs in CI."]
    : []),
  ...(process.env.DEPARKED_E2E_REAL !== undefined && process.env.DEPARKED_E2E_REAL !== "1"
    ? ["DEPARKED_E2E_REAL must be exactly 1."]
    : []),
  ...(missing.length > 0 ? [`Missing: ${missing.join(", ")}.`] : []),
];
if (problems.length > 0) {
  const needs = Object.entries(NEEDED).map(([name, what]) => `  ${name}: ${what}`);
  throw new Error(
    [
      "Refusing to run the real-account E2E suite.",
      ...problems,
      "It needs these environment variables (set them in your shell, never in a committed file):",
      ...needs,
      "It creates only resources named deparked-test-* and removes them afterwards.",
    ].join("\n"),
  );
}

export default defineConfig({
  testDir: "./real",
  outputDir: "./test-results",
  workers: 1,
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
