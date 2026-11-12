# @deparked/admin

The admin Worker `deparked-admin`: TanStack Start on Workers, with D1 (`DB`), the `send_email` binding `EMAIL` and
the secrets under "Environment contract".

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
## The offer API

`POST /api/offer` (`src/routes/api/offer.ts`) is public. It sends no CORS headers, so another site's script
cannot read an answer or send JSON, but a plain cross-site form post does arrive: it is useless without a Turnstile
token solved on this hostname. The logic is `src/server/offer/` (pure, unit-tested with the in-memory D1 and the
fake hosting adapter); the request and response contract is the lander's (`packages/templates` README, "The offer
form contract"), and its field names, limits and redirect fragments are imported from `@deparked/templates`.

- **Request**: JSON or `application/x-www-form-urlencoded`, at most 10 KB, fields `amount`, `name`, `email`,
  `message` (optional), `website` (honeypot), `cf-turnstile-response`. The domain is the request's hostname.
- **JSON answer** (JSON body, or `Accept: application/json`): `200 {"ok":true}`, else
  `{"ok":false,"error":"<sentence for the buyer>","code":"<code>","field"?:"amount"|"name"|"email"}` with `code`
  `invalid` (400; 405, 413, 415), `min-offer` (400), `bot-check` (403), `rate-limited` (429, `Retry-After`),
  `not-for-sale` (404: unknown host, `www.`, or any status but `live`) or `unavailable` (503).
- **Form answer** (no JavaScript): `303` to `/#offer-sent` or `/#offer-error-<amount|name|email|check|rate|failed>`,
  always a fixed path on the same host. A form post has no Turnstile token, so today it always ends in `check`.
- **Order**: honeypot, host lookup (one read), validation (zod), empty-token check, Turnstile through the hosting
  adapter, throttle, `insertOffer`, then the email from `offers@<sender host>` with Reply-To the buyer. Nothing is
  written to D1 before the bot check has passed, so a junk token costs no write; a throttled request has used up
  its solved token. A failed email, or no verified notify address, leaves the offer stored with
  `email_status = failed` and a short `email_error`; the buyer still gets a success.
- **Honeypot**: a filled `website` field is answered like a success and nothing is stored (the schema has no
  place for a suspected-bot offer). A browser autofill that fills the hidden field would lose a real offer the
  same way, so each one logs `offer: honeypot-filled`: a run of those in the Worker's logs with no spam to match
  is the sign.
- **Text**: `name` may not hold control characters or invisible format characters (bidi overrides, zero-width
  space); in `message` the format characters are removed. The zero-width joiner and non-joiner are kept, for
  emoji and the scripts that need them.
- **Client address**: taken from `CF-Connecting-IP`. Without it the answer is `unavailable` and D1 is not
  touched, except on `localhost` and `127.0.0.1`, where local dev shares one counter.
- **Throttle**: per IP (IPv6 /64, hashed like the login counter), across all domains: 5 per 10 minutes and 20 per
  12 hours (`OFFER_BURST`, `OFFER_SUSTAINED`). Counters older than 24 hours are pruned.
- **Logs**: fixed codes only (`offer: email-failed`), never a name, email, amount, message or IP.
- **Cost**: one offer is 2 D1 reads, 4 to 5 D1 writes, one siteverify call and one email. Measured in Node with the
  in-memory D1 and the real adapter (HMAC, zod, MIME): about 1.7 ms wall and 1.9 ms CPU per request, SQLite
  included, so well inside Workers Free's 10 ms. Not measured on Cloudflare itself.

## Publish

The logic is `src/server/publish/pipeline.ts` (pure: `{ db, hosting, now, catalog, headers, release,
fetchReleaseFile }`, unit-tested with the in-memory D1 and the fake hosting adapter); the server functions in
`src/server/publish/functions.ts` each call `requireSession()` first and validate their input with zod.

- **Protocol for a UI**: `startPublish({ kind, host })` (`draft`, `placeholder`, `remove`; or `republish-all`
  without a host) or `revertTo({ historyId })` returns `{ ok: true, deploymentId }` or `{ ok: false, reason }`
  (`busy` names the running deployment). Then call `stepPublish({ deploymentId })` one request at a time while
  it answers `running`, showing its `message` and `progress`; stop at `done` or `failed`. A `failed` with reason
  `credentials-rejected` means the token banner. `getPublishState({ host })` says whether the draft differs from
  live, the domain's last deployment, the lock, and `outOfSync` after an emergency rollback.
- **One step** renders this publish's host (or one host of "republish all"), builds the full manifest (every other
  host's rows from `site_files`, the catalog rows as the installer recorded them, this host's new files) and calls
  `hosting.publish` with at most 30 upload batches. When the host answers `done`, one D1 batch replaces the host's
  `site_files`, makes the draft live with a `config_history` row, sets the domain `live`, finishes the deployment
  and releases the lock. Before that nothing in D1 changes, so a failure at any point leaves D1 as it was.
- **Lock**: one row with a 5-minute TTL, renewed at the start of each step and checked again right before the
  host is called and right before the D1 commit. A step that lost it writes nothing but its own failure. A
  publish that died is marked failed by the next start once its lock expired.
- **Files the host asks for again**: this host's are in memory; another host's are rendered again from its live
  config (if the bytes differ, the templates changed: that host joins this deploy, up to 3 times per step); a
  catalog file is downloaded from `RELEASE_FILES_URL` + path and refused unless size and hash match its row.
- **Revert** makes a `config_history` entry the draft and publishes it like any draft (the draft the owner had is
  replaced, even if that publish then fails). **Rollback** (emergency) puts an earlier `deparked-sites` version
  live without touching D1; the next publish of any kind sends the D1 manifest again and undoes it.
- **Cost**, measured in Node with the in-memory D1 and the fake adapter, not on Cloudflare: render and hash of one
  lander about 1.9 ms CPU (median; p90 5 ms; the first in a fresh process 14 ms); one whole step about 11 ms CPU
  with in-process SQLite, whose queries are I/O on Workers. Subrequests per step: 3 fixed (upload session, script
  upload, deployment) plus one per upload batch (at most 30), plus one download per catalog file Cloudflare asks
  for again. "Republish all" deploys one version per host.

## URLs

A managed domain routes only `<host>/admin*` and `<host>/api/*` here, so built files are served from
`/admin/_assets/*` and server functions from `/admin/_serverFn/*` (`vite.config.ts`). Use plain `<a href>` for links
between the login and setup screens: their state is decided by the middleware on a full request.

## Environment contract

The names this Worker reads, and that the E2E harness passes. `src/server/hosting.ts` builds the hosting adapter
from them, once per request. Local dev loads from `.dev.vars` only the names listed under `secrets.required` in
`wrangler.jsonc`: a second Turnstile widget's secret has to be added there to be seen locally. The two overrides
are not secrets and are not listed: pass them as variables, the way the E2E harness does
(`wrangler dev --var TURNSTILE_VERIFY_URL:http://127.0.0.1:<port>/…` on the build).

| Name | What |
| -- | -- |
| `SESSION_KEY` | Secret. Signs the session cookie and keys the IP hash. At least 32 characters. |
| `CF_API_TOKEN` | Secret. The owner's Cloudflare API token. |
| `CF_ACCOUNT_ID` | The Cloudflare account the hub lives in. `workspace.cf_account_id` wins when the caller passes it. |
| `EMAIL` | `send_email` binding without a fixed destination: offer emails go to verified notify addresses. |
| `TURNSTILE_SECRET_<n>` | Secret of Turnstile widget `deparked-<n>`. |
| `CLOUDFLARE_API_BASE` | Override of the Cloudflare API base URL, for the mock API in tests. Honoured only when it is `http://127.0.0.1:<port>/…` or `http://localhost:<port>/…`; anything else is ignored. |
| `TURNSTILE_VERIFY_URL` | Override of the Turnstile siteverify URL, for tests. Same rule. |
| `RELEASE_FILES_URL` | Optional. Base URL the publish downloads catalog files from when Cloudflare asks for one again (`https://`, or local http). Each file is checked against its hash. Unset: such a publish fails with a readable message. |
