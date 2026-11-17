# Design: Shop Window

How the admin, the first-run flows and the installer are designed, and the rules any change to them
follows. Landers have their own variants and gates and are not covered here.

The general maxims behind this file live in the `product-ux` skill (`web` plugin of the
`dominic-skills` marketplace). This file is the Deparked-specific layer: where the two disagree, this
file wins; where this file is silent, the skill applies. The decision to adopt this direction and Arc
UI is recorded in Linear (comment on DOM-354 and the decision doc); this file describes the result.

## The idea

Deparked's job is to put a domain in a window and bring the owner an offer. The admin shows exactly
that: every domain as its live page, every offer as the amount someone is willing to pay.

## Rules

1. **The page is the product.** A domain is always shown as its live page (a real, scaled render of
   its lander), never only as text.
2. **One question per screen, one main button.**
3. **Show, then tell.** A picture, diagram or icon first, one or two short lines, the rest behind a
   disclosure.
4. **Money is the loudest thing** on any screen it appears on.
5. **Nothing reads "None" or "Never".** An empty spot offers the next step.
6. **Celebrate rarely:** a domain going live, a first offer. Everyday actions are instant.
7. **Plain words.** No Cloudflare terms unless the owner has to act on them in Cloudflare.
8. **Arc first.** If an interface is almost one of Arc UI's free components, use the component. Where
   Arc's part and a mock differ in detail, Arc wins; where its behaviour is wrong for the job, use
   another part and say why in the pull request.

## Look

Tokens are defined once in `packages/ui/src/styles/globals.css` and mapped onto Arc's foundation
variables, so Arc components carry the look without per-component overrides. Use the tokens; never a
literal colour.

| Role | Light | Dark | Token |
| -- | -- | -- | -- |
| Ground | `#f3f5fa` | `#0e1020` | `--background` |
| Ink | `#14162b` | `#f3f5fa` | `--foreground` |
| Quiet text | `#4a4f6b` | `#a9aecb` | `--muted-foreground` |
| Accent (tangerine, ink text on it) | `#ff6a3d` | `#ff7a50` | `--accent` |
| Positive | `#1f9d6b` | `#3cc98f` | `--success` |
| Caution | `#f3c24b` | `#f3c24b` | `--warning` |
| Destructive | `#c2360f` | `#ff7a5c` | `--danger` |

- **Type:** Bricolage Grotesque (`--font-display`) for headings, domain names and money; Instrument
  Sans (`--font-body`) for everything else. Both self-hosted. Money and counts use tabular numerals.
- **Shape:** pills for navigation and actions, about 24 px radius on surfaces (`--radius-surface`).
- **Depth:** soft layered shadows (`--shadow-resting`, `-raised`, `-floating`) for elevation;
  hairlines only for structure.
- **Accent:** one filled tangerine button per screen, the primary action. Tangerine also marks new
  offers (count badges, price tags). Nothing else is tangerine.
- **Motion:** Arc's defaults, press feedback on buttons, no animation on frequent actions, everything
  off or reduced under `prefers-reduced-motion`.

## Words

| Say | Not |
| -- | -- |
| Domains | Overview |
| Offers | Inbox |
| Put it live | Publish |
| Live / Not live yet / Saved, 3 changes not live yet | Published / Draft / Unpublished changes |
| Page, Offers, Visits, Settings (a domain's sub-pages) | Editor, Analytics |
| Where offers go | Notify addresses |
| Cloudflare connection: Connected / Rejected | Token valid / invalid |
| Remove Deparked | Danger zone, Uninstall (as a heading) |
| Finish its page, Fix its setup, Turn it back on | Draft, Error, Off (as the only label) |
| Reply to Ada, I already replied, Not interested | Reply by email, Mark as replied, Ignore |
| `<domain>` is in the window. | Domain set up successfully |

Buttons name the action and its object and stay true to what they do ("Send verification email").
Errors say what happened, what it means for the owner's work, and what to do next.

## Screens

- **Shell:** brand mark, pill navigation (Domains, Offers with the new count, Settings), search button
  that opens the command palette (⌘K), account menu with theme and log out. Global problems (token
  rejected) show as one bar on every screen with the link to the fix.
- **Home:** a greeting, a headline sentence computed from real data ("Six offers are waiting for
  you."), the best new offer with "Reply to …", then each domain as a card with its lander as the
  thumbnail, a status or next step, visits and an offers tag. A list view exists for large
  portfolios and is remembered per browser. On phones each domain is a compact row.
- **Offers:** a compact list beside the selected offer. The amount is the largest element; the
  buyer's message is a speech bubble; one context line places the offer among the domain's others.
  Actions exist only on the selected offer. Selection is `?offer=<id>`; phones open a bottom sheet.
- **Domain page:** back link, name, sub-page pills, and on Page one state line with "Put it live".
  The editor keeps the preview in view beside a rail of groups: Look, Background (only what the look
  draws), Words, Price open; Colours, Google and link previews, Earlier versions collapsed with a
  one-line summary. Fill-in words are chips that show missing, used, or used twice.
- **Flows (installer, first run, add a domain):** one step per screen through the shared frame in
  `@deparked/ui/flow`: step indicator, heading as the question, a drawing, one input, one button.
  Review shows what will be set up as icon rows with the full detail collapsed. Success shows the live
  page in a browser frame with one next action; the log is collapsed into "N things set up".
- **Settings:** a list of sections with an icon, a one-line live status and a dot; the selected
  section opens beside it, and on phones the list is the page.
- **Visits:** headline numbers as plain text, a bar chart with its own 7 / 30 day switch, and the
  same data as a table.

## What must never be traded away for a cleaner screen

- **Consequences stay visible.** "It can change every Worker in this account" and "Turning it off
  later undoes all of it" are not behind a disclosure. Explanations may be; warnings may not.
- **Destructive actions** confirm in a dialog that lists what goes and what stays, with focus on
  Cancel. Removing Deparked keeps its offers-copy step and its typed phrase. No hold-to-confirm: it
  cannot be operated by voice or switch control.
- **Real values in the first paint.** No number counts up from zero; server-rendered pages contain the
  real figures.
- **Without JavaScript** every offer is readable and actionable, filters are links, and disclosures
  open. Controls are disabled until hydration (`html[data-hydrated]`).
- **Buyer data** (names, emails, amounts, messages) never appears in a URL beyond the offer id, in
  logs or in analytics. Hostile text in any buyer field renders inert.
- **A token** is never rendered back.
- **Status** is never colour alone.

## Components

- Arc UI's free components are vendored under `packages/ui/src/components/arc/`, byte-identical to
  upstream, and exported through `@deparked/ui/arc/*`. Never edit a vendored file; adapt in a wrapper
  or at the call site. Never add an Arc Pro component. `packages/ui/LICENSES.md` lists every source.
- Still shadcn, each for a reason: dropdown-menu (the domain switcher needs link items), tabs (the
  editor's Edit / Preview panels), field and label (no Arc equivalent).
- Not used on purpose: Arc's onboarding checklist (steps could be ticked by hand), password-strength
  (its rules contradict passphrase advice), mention-input (cannot enforce "each word exactly once"),
  hold-to-confirm and confirm-morph (see above), animated counters on data.
- Every pull request that touches the admin or installer reports the admin Worker's size from
  `pnpm dry-run`.

## Before a UI change is done

1. Every state looked at in a real browser at 1280 and 390 px, light and dark: empty, one, many,
   error, running, done, and worst-case data (a 60-character domain, a 2,000-character message, zero
   and two hundred items).
2. The ten tests of the `product-ux` skill pass for each screen touched.
3. `break-ui`, `impeccable` and `web-design-guidelines`, as listed under "UI done means" in
   `AGENTS.md`.
4. A new wording follows the table above, or the table is updated in the same pull request.

## Known gaps

- The Visits bar chart draws no bars without JavaScript (numbers and table work).
- "Load more" on Offers needs JavaScript.
- The contrast reading in the editor's Colours group compares text against the accent only.
