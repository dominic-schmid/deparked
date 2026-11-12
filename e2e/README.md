# End-to-end tests

Playwright (Chromium) drives the real Workers on local workerd. Nothing here talks to Cloudflare.

| Command | What it runs |
| -- | -- |
| `pnpm test:e2e` | `tests/` against local Workers, a local D1 and the `packages/cf` mock. No credentials. Runs in CI. |
| `pnpm test:e2e:real` | `real/` against the owner's account on `deparked-test-*` resources. Never in CI. Refuses to start unless `DEPARKED_E2E_REAL=1` and the variables it prints are set. The suite arrives with DOM-370. |

One file: `pnpm test:e2e tests/smoke.spec.ts`. Headed: add `--headed`. Locally the browser is preinstalled; CI installs Chromium itself.

## What a run starts

The global setup builds the admin once (`vite build`). Each Playwright worker (there is one) then starts, on free ports:

| Piece | How | Notes |
| -- | -- | -- |
| Mock Cloudflare | `startMockCloudflare` from `@deparked/cf/mock`, in the test process | Seed: account `e2e-account`, zones `example.com` and `example.org`, token `e2e-dummy-cloudflare-token` |
| `deparked-admin` | `wrangler dev` on the production build (`apps/admin/dist/server/wrangler.json`) | Variables below |
| `deparked-install` | `wrangler dev` on the committed bundle (`apps/install/dist/worker.js`) | Run `pnpm build:install` after changing the installer |
| `deparked-sites` | `wrangler dev` on a temporary copy of `apps/sites/public` | Tests can add files, see `writeSiteFile` |
| Host proxy | a small Node server (`harness/proxy.ts`) | Stands in for the zone's routes and rewrite rule |
| Local D1 | one SQLite file under `e2e/.tmp/`, migrated with `applyMigrations` | Shared, see below |

Everything is stopped when the worker ends. Each `wrangler dev` runs in its own process group; a run that crashed is cleaned up by the next run's global setup. Logs: `e2e/.tmp/logs/<worker>.log`.

**One database for all three.** The admin, the installer and the test process (`getPlatformProxy`) use the same `--persist-to` directory. Wrangler names a local D1 by its binding when the config has no `database_id`, so `DB` is the same SQLite file everywhere, and a write in one is visible in the others at once. This breaks if one `wrangler.jsonc` gets a `database_id` and another does not.

## Variables the Workers must read

The harness passes these with `wrangler dev --var`. No secret file exists or is needed. Code that calls Cloudflare must read the two overrides and fall back to the real URL when they are unset.

| Variable | Given to | Value in E2E | Use |
| -- | -- | -- | -- |
| `CLOUDFLARE_API_BASE` | admin, install | `http://127.0.0.1:<port>/client/v4` | `createCloudflareClient({ baseUrl })` |
| `TURNSTILE_VERIFY_URL` | admin, install | `http://127.0.0.1:<port>/turnstile/v0/siteverify` | `verifyTurnstile({ url })` |
| `CF_API_TOKEN` | admin | `e2e-dummy-cloudflare-token` (the mock accepts only this) | the owner's token; the installer gets it pasted in its page instead (`TEST_TOKEN`) |
| `CF_ACCOUNT_ID` | admin | `e2e-account` | |
| `SESSION_KEY` | admin | a dummy | cookie signing |
| `TURNSTILE_SECRET_1` | admin | Cloudflare's always-pass dummy secret `1x0000000000000000000000000000000AA` | a `turnstile_widgets` row arranged by a test should use `secret_name = 'TURNSTILE_SECRET_1'` and sitekey `1x00000000000000000000AA` (`TURNSTILE_DUMMY_SITEKEY`) |

The mock's siteverify answer is `mock.state.siteverify` (`{ success, hostname }`, default `example.com`).

If the admin or the installer needs another variable, add it in `harness/stack.ts` and to this table.

## Writing a test

Import `test` and `expect` from `../fixtures`, never from `@playwright/test`.

```ts
import { createDb } from "@deparked/db";
import { expect, test } from "../fixtures";

test("a visitor sends an offer", async ({ page, hostUrl, db, mock, writeSiteFile }) => {
  await db.sql("INSERT INTO domains (host, status, created_at, updated_at) VALUES (?, 'live', ?, ?)", "example.com", 0, 0);
  await writeSiteFile("sites/example.com/index.html", html);
  await page.goto(hostUrl("example.com"));
  // …fill the form, submit…
  expect(await db.sql("SELECT amount_minor FROM offers")).toEqual([{ amount_minor: 500000 }]);
  expect(mock.callsTo("email.listAddresses")).toHaveLength(1);
});
```

| Fixture | What it is |
| -- | -- |
| `mock` | The in-process mock Cloudflare. Arrange with `mock.state` (plain data), `mock.failNext({ route, status })`, `mock.denyPermission(…)`, `mock.verifyAddress(email)`. Assert with `mock.calls`, `mock.callsTo(route)`, `mock.deployedAssets("deparked-sites")`, `mock.liveBindings(…)`. |
| `db` | `db.sql(query, ...params)` returns rows; `db.d1` is the `D1Database` for `createDb(db.d1)` and the typed queries in `@deparked/db`. |
| `urls` | `admin`, `install`, `sites` (each Worker directly, `http://127.0.0.1:<port>`), `mock`, `cloudflareApi`, `siteverify`. |
| `hostUrl(host, path?)` | `http://<host>.localhost:<port><path>`: a managed domain as its visitor sees it. |
| `writeSiteFile(path, body)` | Adds a file to the sites Worker and waits until it is served. |
| `resetState()` | Runs before every test already. Fresh mock (same seed), every table emptied (schema kept), written site files removed. |

Constants from `../fixtures`: `TEST_TOKEN`, `TEST_ACCOUNT_ID`, `TEST_SESSION_KEY`, `ZONES`, `TURNSTILE_DUMMY_SITEKEY`, `TURNSTILE_SECRET_NAME`.

### How hosts map

Zone routes and rewrite rules do not exist locally. `hostUrl("example.com", "/x")` goes through the proxy:

| Path | Goes to |
| -- | -- |
| `/admin…`, `/api/…` | the admin Worker, same path |
| `/catalog/…` | the sites Worker, same path |
| `/` | the sites Worker, `/sites/example.com/index.html` |
| anything else | the sites Worker, `/sites/example.com/<path>` |

The Workers see `example.com` as the hostname (`request.url` is `http://example.com/…`, plain http), also in `Origin` and `Referer`. A redirect to `http(s)://example.com/…` comes back to the proxy. So a lander's form posts same-origin to `/api/offer`, as in production.

- Only Chromium resolves `*.localhost` on every machine. Use `page.goto` or `page.evaluate(() => fetch(…))` for `hostUrl` addresses, not Playwright's `request` fixture. `request` is fine for `urls.admin` and the other direct addresses.
- Chromium treats `*.localhost` as secure, so `Secure` cookies work over http there.
- Before a domain is attached, the admin is used on `urls.admin` directly, as on `workers.dev`.

### Publishing

A publish from the admin lands in the mock, not in the local sites Worker. To show what was published to a visitor:

```ts
for (const [path, file] of mock.deployedAssets("deparked-sites")) await writeSiteFile(path.replace(/^\//, ""), file.body);
```

## Limits

- One worker, tests run in order. State is reset before each test, not the processes: a Worker's in-memory state survives between tests.
- The Workers run the build, not a dev server: rebuild happens at the start of every run, not while it runs.
- The installer's real path (Deploy button, real token, real uploads) is only covered by `pnpm test:e2e:real`.
- Client IP: every request reaches the Workers from `127.0.0.1`.
