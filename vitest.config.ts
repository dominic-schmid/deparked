import { defineConfig } from "vitest/config";

// One run over every workspace package; a package with tests adds its own vitest.config.ts. apps/admin joins
// with its own config once it has tests (its vite.config.ts loads the Cloudflare plugin, which vitest must not).
// scripts/hooks uses node:test (no install needed) and runs via `pnpm test:guard` instead.
export default defineConfig({
  test: {
    projects: ["packages/*", { test: { name: "scripts", include: ["scripts/*.test.ts"] } }],
    passWithNoTests: true,
  },
});
