# @deparked/admin

The admin Worker `deparked-admin`: TanStack Start on Workers, with D1 (`DB`), the `send_email` binding `EMAIL` and
the secrets under "Environment contract".

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
