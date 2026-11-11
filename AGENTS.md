<!-- intent-skills:start -->
## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:
- Run `pnpm exec intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm exec intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# Agent guide

Deparked: manage domain-for-sale pages from one admin panel. A static lander per domain, one shared admin, installed with a Deploy to Cloudflare button and one pasted token. Cloudflare first; hosting adapters later.

**Before any work, read the decision doc** ([Decision: Deparked v1 architecture](https://linear.app/dominic-schmid/document/decision-deparked-v1-architecture-7b535835e4d2)) and the Linear issue you're working on ([project](https://linear.app/dominic-schmid/project/deparked-815fa00b70c6)). Linear wins over anything in this repo. Decisions go into the decision doc, never into repo ADRs.

## Map

- `apps/install`: bootstrap Worker `deparked-install`, the Deploy button target. Self-contained folder; its built file is generated and committed. Installs the release with the owner's token.
- `apps/sites`: static-assets-only Worker serving every domain's lander from `/sites/<host>/`. No script.
- `apps/admin`: TanStack Start app on Workers: `/admin` UI, `POST /api/offer`, publish.
- `packages/config`: zod schema for a domain's config. `packages/templates`: `render(config, host)` → static files, plus prebuilt island bundles. `packages/ui`: shadcn/Ruixen components shared by admin, install and landers. `packages/db`: D1 schema, migrations, typed queries. `packages/cf`: minimal Cloudflare API client. `packages/provision`: idempotent setup steps run by the installer and the admin, recorded in the ledger.
- Hosting is behind an adapter boundary (publish, routing, bot check, email, analytics). Only `packages/cf` and `packages/provision` know Cloudflare; everything else talks to the adapter interface.
- [docs/skills.md](docs/skills.md): which skills apply and where they come from. None are in this repo: generic skills come from the `dominic-skills` marketplace (dominic-schmid/ai) as plugins, TanStack's from its npm packages via Intent. Lifecycle: `ship` → `self-review` → `steward` (core plugin, configured by "Agent workflow" below); [scripts/hooks/guard.ts](scripts/hooks/guard.ts) is this repo's PreToolUse guard.

## Hard rules

- The repository is **public**. Never change its visibility, settings or secrets, and never commit anything that isn't fit to publish.
- Never deploy from CI; CI only publishes GitHub Releases. Agents change Cloudflare only through the Cloudflare connector, on test resources.
- Never print, log or commit a Cloudflare token or Worker secret. `.dev.vars` / `.env` stay local.
- Testing against Cloudflare: the owner's account, throwaway subdomains of existing zones, resources named `deparked-test-*`, torn down after. Never touch wrappr.app's live Worker or routes.
- The lander is static: no Worker script or storage read per page view. Client JS is limited to the variant's prebuilt islands (hydrated components, built at release time), the offer form and Turnstile, and the page must read fine without it.
- Buyer data (names, emails, amounts) never goes to logs or analytics.
- Work is tracked as checklists in Linear issues: tick the boxes you finish. New issues only for genuine blockers, with the owner's OK.

## Git conventions

- Conventional Commits: `type(scope): summary`, imperative, subject ≤ 72 chars.
- No AI attribution anywhere: no `Co-Authored-By: Claude`, no `Claude-Session:`, no "Generated with Claude Code".
- Squash-merged PRs; the PR title becomes the commit subject.

## Engineering principles

Smallest change that solves it; delete before adding; name the data shape first; validate at boundaries and trust internal types; idempotent operations; fix root causes; test behaviour, not implementation; prove it works against the real artifact; encode repeated instructions as a lint, test or type.

## Working style

The owner wants brief, objective answers, clarifying questions on complex tasks, and to understand changes before they're applied. Say so when something is a bad idea. Prefer boring, explicit code.

## Commands

- `pnpm check`: typecheck, Biome, Vitest, the guard tests, and the `apps/install/worker.js` staleness check. Run before every push.
- `pnpm format`: Biome autofix.
- `pnpm build`, then `pnpm dry-run`: bundle all three Workers with `wrangler deploy --dry-run` (what CI runs). Never a real deploy: CI only publishes GitHub Releases (`.github/workflows/release.yml`, on a `v*` tag).
- `pnpm install:build`: regenerate `apps/install/worker.js` from `packages/bootstrap`; commit the result.
- `pnpm e2e`: Playwright E2E against local Workers.
- `pnpm exec intent list` / `pnpm exec intent load <pkg>#<skill>`: TanStack skills; load before editing `apps/admin`.
- `node --test scripts/hooks/guard.test.ts`: guard tests alone (no install needed).

## Agent workflow

<!-- Read by the core plugin's ship / self-review / steward skills (dominic-skills marketplace). -->

- Check: `pnpm check`
- Tracker: Linear team `DOM`, project "Deparked"; work is checklists inside the 7 surface issues
- Plan docs: Linear document "Decision: Deparked v1 architecture"
- Decisions go to: Linear document "Decision: Deparked v1 architecture"
- Merge: agent
- Merge method: squash
- Sensitive paths: `scripts/hooks/guard.ts` SENSITIVE_PATHS
- Review bots: CodeRabbit (summary only, never wait for it)
- UI done means: `break-ui`, `impeccable`, `web-design-guidelines`; lander variants also pass the 25-viewport layout and Lighthouse gates
- Attribution: none (a hook blocks it)
