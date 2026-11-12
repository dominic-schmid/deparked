# @deparked/templates

Turns a domain's config into the static files `deparked-sites` serves for it. The same call renders the admin's live preview (in the browser) and the published page (in the admin Worker).

```ts
import { render, renderPlaceholder } from "@deparked/templates";
import { catalog } from "@deparked/templates/catalog";

const files = render(config, "example.com", { catalog, sitekey, beaconToken });
// { "index.html": "...", "robots.txt": "...", "sitemap.xml": "..." }  → /sites/example.com/*

const before = renderPlaceholder("example.com"); // same three files, noindex, links to /admin
```

- `render(config, host, options)` is pure: no clock, no randomness, no I/O, no Node APIs. The same input gives the same bytes in Node, workerd and a browser.
- `options`: `catalog` (the release's `/catalog/catalog.json`; `@deparked/templates/catalog` is this release's copy), `sitekey` (Turnstile), `beaconToken?` (Web Analytics; no beacon without it), `offerEndpoint?` (default `/api/offer`).
- `config` is a parsed `Config` from `@deparked/config`. Every value is escaped on the way out; `host` is percent-encoded wherever it becomes part of a URL.
- The HTML carries all copy, the meta tags, JSON-LD and the inlined CSS. The only scripts are the variant's island bundle (`/catalog/islands/<variant>.<hash>.js`), Turnstile, and the analytics beacon when a token is given.
- JSON-LD is a `WebPage` about the domain, not a `Product` with an `Offer`: an `Offer` needs a real price, and the minimum offer is a quiet filter, not an asking price.

## What is generated, and when

| Output | Made by | When |
| -- | -- | -- |
| `src/**/styles.generated.ts` (each variant's Tailwind CSS, purged to its markup) | `pnpm build:templates` | after any change to a variant's markup or `styles.css` |
| `apps/sites/public/catalog/islands/*.js` and the `islands` and `gradients` sections of `catalog.json` | `pnpm build:templates` | after any change to code an island imports |
| `catalog/backgrounds/*` and the `backgrounds` section | `pnpm --filter @deparked/templates catalog:images` | by hand, when a source image under `assets/backgrounds` changes |
| `catalog/fonts/*` and the `fonts` section | `pnpm --filter @deparked/templates catalog:fonts` | by hand, when a font changes (needs network) |

All of it is committed, because Tailwind, esbuild and sharp cannot run in the admin Worker. `pnpm check:templates-fresh` (run in CI) rebuilds the first two rows and fails if a committed file differs. Images and fonts are not rebuilt in CI: encoders differ between platforms. A test checks instead that every file in the manifest exists and matches its hash.

Budgets, enforced by tests: `index.html` under 30 KB gzipped, each island bundle under 90 KB gzipped.

## Adding a variant

1. Create `src/variants/<id>/` (`<id>` is one of `VARIANTS` in `@deparked/config`) with:
   - `Page.tsx`: everything inside `<body>`, a component of `PageProps`. Plain markup; wrap whatever needs client JavaScript in `<Island name component props>`.
   - `styles.css`: copy the first lines of `sky/styles.css` (the Tailwind imports and the two `@source` lines), then your `@theme` tokens and styles. Only classes used in this folder end up in the page.
   - `index.ts`: `export const <id>: VariantDefinition = { Page, css, fonts, color, contrast }`, with `css` imported from `./styles.generated`.
   - `client.ts`, only if the variant has islands: `hydrateIslands({ "<name>": Component })` with the same names the page uses. The offer form of Sky (`sky/OfferForm.tsx`) can be imported or copied.
2. Add one line to the registry in `src/variants/index.ts`.
3. Run `pnpm build:templates`, then `pnpm check` and `pnpm test:layout`. The layout gate, the form tests and the no-JavaScript tests pick the variant up from the registry.

A variant's form must keep the offer form contract below, and the page must read and submit without JavaScript.

## The offer form contract

Frozen here and in `src/offer.ts` (`OFFER_FIELDS`, `OFFER_LIMITS`, `OfferRequest`, `OfferResponse`, `OFFER_ERROR_REASONS`). The server side is `POST /api/offer` in the admin Worker.

**Request.** `POST` to the page's own host, path `/api/offer`. The domain is the request's `Host`; it is not a field.

| Field | Meaning | Limit |
| -- | -- | -- |
| `amount` | The offer in whole major units of the page's currency. JSON: an integer. Form-encoded: a string that may hold grouping characters (`1,500`); keep its digits. | 9 digits |
| `name` | The buyer's name | 100 characters |
| `email` | The buyer's email address | 200 characters |
| `message` | Optional free text. No variant sends it yet. | 2000 characters |
| `website` | Honeypot, hidden from people. If it is not empty, answer as for a success and drop the offer. | |
| `cf-turnstile-response` | The Turnstile token | |

The server validates everything again, including the minimum offer: the browser's check is a courtesy.

**With JavaScript** the island sends `content-type: application/json` (`OfferRequest`) and expects JSON back (`OfferResponse`):

- any `2xx`: the offer was taken. The body is `{ "ok": true }`.
- any other status: `{ "ok": false, "error": "<one sentence for the buyer>", "field"?: "amount" | "name" | "email" }`. The page shows `error` as it is, on `field` when one is named. Without a readable body it shows "That didn't go through. Try again in a minute."

**Without JavaScript** the browser posts `application/x-www-form-urlencoded` with the same field names (no Turnstile token: the widget needs JavaScript). Answer with `303 See Other`:

- `Location: /#offer-sent` after a success,
- `Location: /#offer-error-<reason>` otherwise, with `<reason>` one of `amount`, `name`, `email`, `check` (Turnstile), `rate` (rate limit), `failed` (anything else).

The static page holds a message for each of these and shows it with CSS `:target`; no script is involved. A fragment, not a query string, because a static page cannot read `?offer=sent` without a script. Tell the two kinds of request apart by `content-type`.

## Serving notes for `deparked-sites`

- `apps/sites/public/_headers` gives the hashed catalog folders a one-year immutable cache. Wrangler reads that file at deploy and sends it as asset configuration; a deploy through the API has to pass it the same way, it is not served as a file.
- `html_handling` stays `"none"`; the zone's rewrite rule maps `/` to `/sites/<host>/index.html` and leaves `/catalog/*` alone.
