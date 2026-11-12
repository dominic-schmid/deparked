# @deparked/admin

The admin Worker `deparked-admin`: TanStack Start on Workers, with D1 (`DB`) and the secret `SESSION_KEY`.

## Local dev

```sh
cp .dev.vars.example .dev.vars                 # dummy SESSION_KEY; .dev.vars is git-ignored
pnpm --filter @deparked/admin dev:seed         # local D1 only: migrations, workspace row, a known setup secret
pnpm --filter @deparked/admin dev              # then open the setup link dev:seed printed
```

`dev:seed` is the only thing that migrates the local database (in production the installer does it). Run it again
after pulling a new migration, or to reset a forgotten local password: it re-arms the setup secret. Without it every
page answers 500 with "no such table: workspace".

## Auth in one page

All of it is in `src/server/auth/` (pure, unit-tested) and wired by one global request middleware,
`src/server/guard.ts`, registered in `src/start.ts`. For every request, in order:

1. `/api/*` passes untouched: public, with its own checks.
2. Origin check on POST/PUT/PATCH/DELETE: `Origin` (or `Referer` when `Origin` is absent) must equal the request's
   own origin, else 403.
3. Auth gate, default deny: only `/admin/login`, `/admin/setup`, `/admin/setup/done` and the `/` redirect are open.
   Anything else without a valid session is redirected to login (to setup while a first-run secret is pending); a
   server function call gets 401.
4. The handler runs.
5. Security headers (CSP with a per-response nonce, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy:
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
- **Log out** clears this browser's cookie. **Change password** bumps `session_version`, which ends every session,
  and gives the caller a new cookie.
- **Login rate limit**: 5 attempts per 15 minutes per IP, counted in D1 under an HMAC of the IP. Checking the
  current password when changing it shares the counter.
- **Setup secret**: the installer stores the lowercase hex SHA-256 of the secret (`hashSetupSecret`) and an expiry.
  `/admin/setup?secret=…` checks it and stores the password in one SQL statement (`consumeSetupSecret`).

## URLs

A managed domain routes only `<host>/admin*` and `<host>/api/*` here, so built files are served from
`/admin/_assets/*` and server functions from `/admin/_serverFn/*` (`vite.config.ts`). Use plain `<a href>` for links
between the login and setup screens: their state is decided by the middleware on a full request.
