# Skills

No skill files live in this repo. Generic skills come from the owner's `dominic-skills` marketplace ([dominic-schmid/ai](https://github.com/dominic-schmid/ai)) as plugins; TanStack's ship inside its npm packages. Use the Skill tool; plugin skills are namespaced (`core:ship`, `cloudflare:wrangler`, `emil-kowalski:break-ui`). Hard rules in `AGENTS.md` beat any skill.

## Plugins this repo enables (`.claude/settings.json`)

| Plugin | Use it for |
| -- | -- |
| `core` | `ship` → `self-review` → `steward` (configured by AGENTS.md "Agent workflow"), `tdd`, `grilling`, `codebase-design` (the hosting adapter boundary), `domain-modeling` (config schema), reviewer and researcher agents |
| `landing-page` | `design-taste-frontend` (every variant and admin screen), `impeccable` (polish gate), Emil Kowalski's skills (`emil-design-eng`, `break-ui`, `review-animations`), `make-interfaces-feel-better`, `web-design-guidelines`, `modern-web-guidance` (any HTML/CSS/client JS) |
| `cloudflare-stack` | Cloudflare's official skills (`workers-best-practices`, `wrangler`, `workers-development`, `frameworks-on-cloudflare` for TanStack Start on Workers, `turnstile-spin`, `cloudflare-email-service`, `web-perf`), plus `cloudflare-d1` and `drizzle-orm-d1` for `packages/db` |
| `security` | `security-threat-model` and `security-audit`: auth, publish, provisioning; full audits only when the owner asks |

## TanStack (via TanStack Intent)

Official skills ship in `@tanstack/react-start`, `@tanstack/react-router` and `@tanstack/router-core`, version-matched to what's installed. `package.json#intent.skills` allows `@tanstack/*`. List with `pnpm exec intent list`, then load the most specific with `pnpm exec intent load <package>#<skill>` before editing admin code (see the Intent block in `AGENTS.md`).

## Getting the plugins

- **Local Claude Code:** trust the folder and accept the plugin install prompt (needs git access to the private `dominic-schmid/ai`).
- **Cloud sessions** ignore repo plugin settings. Use a cloud environment whose setup script is `scripts/cloud-setup.sh` from the ai repo with `PLUGINS="core landing-page cloudflare-stack security"`, and attach `dominic-schmid/ai` to the session while that repo is private.
