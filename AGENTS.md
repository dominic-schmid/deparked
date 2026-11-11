# Agent guide

Deparked: manage domain-for-sale pages from one admin panel. A static lander per domain, one shared admin, set up in one click through Claude. Cloudflare first; hosting adapters later.

**Before any work, read the decision doc** ([Decision: Deparked v1 architecture](https://linear.app/dominic-schmid/document/decision-deparked-v1-architecture-7b535835e4d2)) and the Linear issue you're working on ([project](https://linear.app/dominic-schmid/project/deparked-815fa00b70c6)). Linear wins over anything in this repo. Decisions go into the decision doc, never into repo ADRs.

## Map

- `apps/sites`: static-assets-only Worker serving every domain's lander from `/sites/<host>/`. No script.
- `apps/admin`: TanStack Start app on Workers: `/admin` UI, `POST /api/offer`, publish.
- `packages/config`: zod schema for a domain's config. `packages/templates`: `render(config, host)` → static files. `packages/db`: D1 schema, migrations, typed queries. `packages/cf`: minimal Cloudflare API client. `packages/provision`: idempotent setup steps run by the `deparked-setup` skill.
- Hosting is behind an adapter boundary (publish, routing, bot check, email, analytics). Only `packages/cf` and `packages/provision` know Cloudflare; everything else talks to the adapter interface.
- [docs/skills.md](docs/skills.md): which skills apply and where they come from. None are in this repo: generic skills come from the `dominic-skills` marketplace (dominic-schmid/ai) as plugins, TanStack's from its npm packages via Intent. Lifecycle: `ship` → `self-review` → `steward` (core plugin, configured by "Agent workflow" below); [scripts/hooks/guard.ts](scripts/hooks/guard.ts) is this repo's PreToolUse guard.

## Hard rules

- The repository stays **private**. Never change its visibility, settings or secrets.
- Never deploy from CI. Deploys and Cloudflare changes go through the Cloudflare connector.
- Never print, log or commit a Cloudflare token or Worker secret. `.dev.vars` / `.env` stay local.
- Testing against Cloudflare: the owner's account, throwaway subdomains of existing zones, resources named `deparked-test-*`, torn down after. Never touch wrappr.app's live Worker or routes.
- The lander is static: no Worker script or storage read per page view, no client JS beyond the offer form and Turnstile.
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

- `node --test scripts/hooks/guard.test.ts`: guard tests (no install needed).
- The rest (`pnpm check` etc.) arrives with the monorepo scaffold (Foundations issue).

## Agent workflow

<!-- Read by the core plugin's ship / self-review / steward skills (dominic-skills marketplace). -->

- Check: `pnpm check` (until the monorepo exists: `node --test scripts/hooks/guard.test.ts`)
- Tracker: Linear team `DOM`, project "Deparked"; work is checklists inside the 7 surface issues
- Plan docs: Linear document "Decision: Deparked v1 architecture"
- Decisions go to: Linear document "Decision: Deparked v1 architecture"
- Merge: agent
- Merge method: squash
- Sensitive paths: `scripts/hooks/guard.ts` SENSITIVE_PATHS
- Review bots: CodeRabbit (summary only, never wait for it)
- UI done means: `break-ui`, `impeccable`, `web-design-guidelines`; lander variants also pass the 25-viewport layout and Lighthouse gates
- Attribution: none (a hook blocks it)
