# @deparked/admin

The admin Worker `deparked-admin`: TanStack Start on Workers, with D1 (`DB`) and the secret `SESSION_KEY`.

## Local dev

```sh
cp .dev.vars.example .dev.vars                 # dummy SESSION_KEY; .dev.vars is git-ignored
pnpm --filter @deparked/admin dev:seed         # local D1 only: migrations, workspace row, a known setup secret
pnpm --filter @deparked/admin dev              # then open the setup link dev:seed printed
pnpm --filter @deparked/admin dev:demo         # optional: dummy domains and offers, worst cases included
```

`dev:seed` is the only thing that migrates the local database (in production the installer does it). Run it again
after pulling a new migration, or to reset a forgotten local password: it re-arms the setup secret. Without it every
page answers 500 with "no such table: workspace".

## Auth in one page

All of it is in `src/server/auth/` (pure, unit-tested) and wired by one global request middleware,
`src/server/guard.ts`, registered in `src/start.ts`. For every request, in order:

1. `/api/*` passes untouched: public, with its own checks.
2. Plain http is redirected to https (308), except on localhost. No HSTS: on a managed domain it would bind the
   lander too.
3. Origin check on POST/PUT/PATCH/DELETE: `Origin` (or `Referer` when `Origin` is absent) must equal the request's
   own origin, else 403.
4. A setup link (`/admin/setup?secret=…`) is redirected to `/admin/setup?link=1`, with the secret moved into a
   one-hour `HttpOnly; Secure; SameSite=Strict` cookie. The secret never appears in a redirect.
5. Auth gate, default deny: only `/admin/login`, `/admin/setup`, `/admin/setup/done` and the `/` redirect are open.
   Anything else without a valid session is redirected to login (to setup while a first-run secret is pending); a
   server function call gets 401.
6. The handler runs.
7. Security headers (CSP with a per-response nonce, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy:
   same-origin`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`) go on every response, errors and redirects too.

Adding something authenticated:

- **A page** under `src/routes/admin/`: nothing to do, the gate covers it.
- **A server function**: it lives under `/admin/_serverFn`, so the gate covers it too. Still call
  `await requireSession()` (`src/server/require-session.ts`) first in the handler: it is the check next to the data,
  and it also covers calls made in-process while rendering on the server.
- **A server route handler** (`server.handlers`): same, call `requireSession()` first.
- **Something public** must be under `/api/` or be added to `gate()` with a test.

Decisions:

- **Password hash**: PBKDF2-SHA256, 25,000 iterations, 16-byte salt, stored with its iteration count. See
  `password.ts` for the measurement behind the number (Workers Free: 10 ms CPU per request).
- **Session**: a signed cookie `v1.<session_version>.<issued>.<expires>.<HMAC-SHA256>`, 30 days, fixed (not
  sliding). `HttpOnly; Secure; SameSite=Strict; Path=/`, no `Domain`, named `__Host-deparked_session`. Checked
  against `workspace.session_version` on every request. Only on `http://localhost` (and 127.0.0.1, [::1]) the cookie
  drops `Secure` and the prefix.
- **Log out** only clears this browser's cookie. It does not invalidate a copied cookie: the session is a signed
  token, not a database row. **Log out everywhere** (on the password screen) bumps `session_version`, which ends
  every session. **Change password** does the same and gives the caller a new cookie.
- **Login rate limit**: 5 attempts per 15 minutes per IP, counted in D1 under an HMAC of the IP (IPv6: of its /64).
  Checking the current password when changing it shares the counter. A failed attempt also deletes counters older
  than 24 hours.
- **Logs**: invocation logs are off (`wrangler.jsonc`), because they record request URLs and the setup link carries
  its secret in the query.
- **Setup secret**: the installer stores the lowercase hex SHA-256 of the secret (`hashSetupSecret`) and an expiry.
  Setup checks it and stores the password in one SQL statement (`consumeSetupSecret`).

## Screens and server code

- `src/routes/admin/_shell.tsx` is the layout of every logged-in screen (switcher, navigation, ⌘K, theme). Put a
  new screen under `src/routes/admin/_shell/`. The selected domain is in the URL: `/admin/d/<host>`.
- Server code is grouped by feature in `src/server/`: `<feature>.ts` holds the logic as plain functions of
  `(db, hosting, input)`, unit-tested with the in-memory D1 and `createFakeHosting()`; `<feature>.functions.ts`
  wraps them as server functions (`requireSession()`, zod input, plain data out).
- `getHosting()` in `src/server/hosting.ts` is the only place that builds the hosting adapter.
- Dates, amounts and relative times are formatted in a fixed locale (`src/components/format.ts`), with "now" taken
  from the loader, so the server and the browser render the same text.

## URLs

A managed domain routes only `<host>/admin*` and `<host>/api/*` here, so built files are served from
`/admin/_assets/*` and server functions from `/admin/_serverFn/*` (`vite.config.ts`). Use plain `<a href>` for links
between the login and setup screens: their state is decided by the middleware on a full request.

## Environment contract

The names this Worker reads, and that the E2E harness passes. Only `SESSION_KEY` is read today; later PRs must
use these names for the rest.

| Name | What |
| -- | -- |
| `SESSION_KEY` | Secret. Signs the session cookie and keys the IP hash. At least 32 characters. |
| `CF_API_TOKEN` | Secret. The owner's Cloudflare API token. |
| `CF_ACCOUNT_ID` | The Cloudflare account the hub lives in. |
| `TURNSTILE_SECRET_<n>` | Secret of Turnstile widget `deparked-<n>`. |
| `CLOUDFLARE_API_BASE` | Override of the Cloudflare API base URL, for the mock API in tests. |
| `TURNSTILE_VERIFY_URL` | Override of the Turnstile siteverify URL, for tests. |
