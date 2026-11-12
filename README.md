# Deparked

Pretty for-sale pages for the domains you own, managed from one admin panel. Zero commission.

Deparked runs entirely in your own Cloudflare account, on the free plan. Every domain gets a fast static page with an
offer form; one admin panel, reachable at `/admin` on any of your domains, manages all of them. Nothing runs on servers
of ours: there are none.

## Install

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dominic-schmid/deparked/tree/main/apps/install)

1. **Deploy button.** Log in to Cloudflare and connect GitHub. Cloudflare copies `apps/install` into a new repository
   of yours, creates the database `deparked` and deploys the installer Worker `deparked-install` on your `workers.dev`
   address, then opens it.
2. **Connect.** The installer opens Cloudflare's Create Token page with every permission filled in. Create the token,
   copy it and paste it into the installer. It checks the token, names any missing permission, and proves that the
   token belongs to the account the installer runs in: it writes a one-time value into its own database and reads it
   back through Cloudflare's API with your token. A token of another account cannot do that, so nobody who finds the
   installer's address can take it over.
3. **Review and install.** The installer lists what it will create, then runs one step per request from your browser:
   download and check the release, prepare the database, upload the pages Worker `deparked-sites` with the shared
   designs, install the admin Worker `deparked-admin` with the database, the email binding and your token as a secret.
   A failed step shows Retry; every step checks what exists first and repeats nothing. Close the tab half way and the
   next visit continues where it stopped.
4. **Create your password.** The installer shows a one-time setup link to your admin panel
   (`deparked-admin.<account>.workers.dev/admin/setup`). It works once, for 24 hours.

Adding your first domain happens in the admin panel, afterwards. The hub works without any domain.

### What gets installed

The installer installs one pinned release: a GitHub Release of this repository built by CI on a `v*` tag (the admin
Worker, its client files, the shared designs, the database migrations and `release.json`). The installer pins the
release's version and the SHA-256 of its `release.json`, and every file is checked against `release.json` before it is
uploaded. CI only publishes releases; it never deploys to Cloudflare.

Everything Deparked creates is written to a ledger in its database, with its Cloudflare id. Deparked never overwrites
or deletes anything it did not create: a Worker named `deparked-sites` or `deparked-admin` that is not in the ledger
stops the install with an explanation.

## The token

One token, pasted once into the installer, never into a chat or a URL. It is stored only as the secret `CF_API_TOKEN`
of the admin Worker; the installer keeps it in memory for the request it is sent with.

| Permission | Why |
| -- | -- |
| Account · Workers Scripts · Edit | installs and updates the two Deparked Workers and publishes your pages |
| Account · D1 · Edit | sets up and updates the Deparked database |
| Account · Account Settings · Edit | creates a visitor statistics site (Web Analytics) for each domain |
| Account · Account Analytics · Read | reads visitor numbers for the overview |
| Account · Turnstile · Edit | sets up the bot check of the offer form |
| Account · Email Routing Addresses · Edit | adds the address offers are sent to |
| Zone · Zone · Read | lists the domains in your account |
| Zone · Workers Routes · Edit | points a domain at its for-sale page |
| Zone · DNS · Edit | adds an address record where a domain has none, and looks at existing mail records |
| Zone · Transform Rules · Edit | maps each domain onto its own pages |
| Zone · Dynamic URL Redirects · Edit | sends `www` to the domain itself |
| Zone · Zone Settings · Edit | turns on Cloudflare's email service for a domain, only when you allow it |
| Zone · Email Routing Rules · Edit | sends offer emails from the domain |

Be aware: **Workers Scripts · Edit covers every Worker in the account**, not only Deparked's. Cloudflare cannot narrow
it to one Worker. If you rotate or delete the token, your pages keep working (they are static files); publishing and
domain changes stop until you paste a new token.

## Recovery

Lost your password or the setup link? Open the installer again (`deparked-install.<account>.workers.dev`) and paste a
token for the same account. After the same ownership check it gives you a new one-time setup link; earlier links stop
working.

## Uninstall

Uninstall undoes the ledger: it turns every domain off (each gets back exactly what it served before Deparked) and then
deletes the bot checks and the two Workers Deparked created, the admin last. Export your offers first. It never deletes
what it did not create, so two things stay for you to delete in Cloudflare's dashboard: the installer Worker
`deparked-install` and the database `deparked`, which the Deploy button made. Delete your copy of the installer
repository on GitHub too, or Cloudflare redeploys the installer on its next push.

## Free plan limits

Deparked is built for Cloudflare's free plan. The binding limit is Turnstile (20 bot-check widgets of 10 hostnames each:
about 200 domains). It uses three Workers whatever the number of domains, one D1 database (about a million offers), and
visitors never run a Worker: every page is a static file. Each install or publish step is one request, sized for one request's
limits (50 subrequests, 10 ms CPU).

## Developing

Read [AGENTS.md](AGENTS.md) first. `pnpm check` runs the typecheck, Biome and the tests; `pnpm test:e2e` drives the
three Workers on local workerd against a mock Cloudflare API, the installer included; `pnpm build:release` builds a
release into `release/`.
