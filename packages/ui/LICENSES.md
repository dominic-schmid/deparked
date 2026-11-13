# Component sources and licences

Every file under `src/components` is copied source (`ui/` wrappers aside), not a runtime dependency. All of it was checked on **2026-11-11**.

## Where the licences were read

- **shadcn/ui**: MIT. `LICENSE.md` in <https://github.com/shadcn-ui/ui>: "Copyright (c) 2023 shadcn".
- **Ruixen UI**: MIT.
  - `LICENSE.md` in <https://github.com/ruixenui/ruixen.com>: "MIT License. Copyright (c) 2025 Ruixen UI".
  - <https://ruixen.com/llms.txt>: "License: MIT".
  - <https://ruixen.com> FAQ: "Ruixen UI is MIT licensed. Use it in personal, commercial, or client projects without restriction. The source is yours once you add it."
  - Only the free registry (`https://ruixen.com/r/<name>`) is used. Ruixen Pro (`pro.ruixen.com`) is a paid product under its own terms and must not be copied here.

- **Arc UI**: MIT. <https://uiarc.dev/llms.txt>: "121 components and 22 blocks are free and open source (MIT)". The registry carries no `LICENSE` file and names no copyright holder, so `src/components/arc/LICENSE` credits "Arc UI (https://uiarc.dev)" as the site does. Only the free registry (`https://uiarc.dev/r/<name>.json`) is used. Arc Pro is licensed separately and must not be copied here.

Ruixen's registry has no plain primitives (button, input, dialog and so on); it holds composed, animated components. The primitives therefore come from shadcn/ui.

## Files

"Client JS" says whether the component needs hydration to work. All of them render on the server; a lander may use a "yes" component only inside an island.

| File | Source | Licence | Client JS | Local changes |
| -- | -- | -- | -- | -- |
| `src/components/ui/alert-dialog.tsx` | shadcn/ui `alert-dialog` (new-york, `npx shadcn@latest add alert-dialog`) | MIT | yes | formatted |
| `src/components/ui/alert.tsx` | shadcn/ui `alert` (new-york, `npx shadcn@latest add alert`) | MIT | no | formatted |
| `src/components/ui/avatar.tsx` | shadcn/ui `avatar` (new-york, `npx shadcn@latest add avatar`) | MIT | no | formatted |
| `src/components/ui/card.tsx` | shadcn/ui `card` (new-york, `npx shadcn@latest add card`) | MIT | no | formatted |
| `src/components/ui/command.tsx` | shadcn/ui `command` (new-york, `npx shadcn@latest add command`) | MIT | yes | formatted |
| `src/components/ui/dialog.tsx` | shadcn/ui `dialog` (new-york, `npx shadcn@latest add dialog`) | MIT | yes | formatted |
| `src/components/ui/dropdown-menu.tsx` | shadcn/ui `dropdown-menu` (new-york, `npx shadcn@latest add dropdown-menu`) | MIT | yes | formatted |
| `src/components/ui/field.tsx` | shadcn/ui `field` (new-york, `npx shadcn@latest add field`) | MIT | no | formatted |
| `src/components/ui/label.tsx` | shadcn/ui `label` (new-york, `npx shadcn@latest add label`) | MIT | no | formatted |
| `src/components/ui/radio-group.tsx` | shadcn/ui `radio-group` (new-york, `npx shadcn@latest add radio-group`) | MIT | yes | formatted |
| `src/components/ui/scroll-area.tsx` | shadcn/ui `scroll-area` (new-york, `npx shadcn@latest add scroll-area`) | MIT | yes | formatted |
| `src/components/ui/select.tsx` | shadcn/ui `select` (new-york, `npx shadcn@latest add select`) | MIT | yes | formatted |
| `src/components/ui/separator.tsx` | shadcn/ui `separator` (new-york, `npx shadcn@latest add separator`) | MIT | no | formatted |
| `src/components/ui/sheet.tsx` | shadcn/ui `sheet` (new-york, `npx shadcn@latest add sheet`) | MIT | yes | formatted |
| `src/components/ui/skeleton.tsx` | shadcn/ui `skeleton` (new-york, `npx shadcn@latest add skeleton`) | MIT | no | formatted |
| `src/components/ui/table.tsx` | shadcn/ui `table` (new-york, `npx shadcn@latest add table`) | MIT | no | formatted |
| `src/components/ui/tabs.tsx` | shadcn/ui `tabs` (new-york, `npx shadcn@latest add tabs`) | MIT | yes | formatted |
| `src/components/arc/foundation.css`, `motion-tokens.ts`, `lib/motion-tokens.ts` | Arc `arc-foundation` and `arc-motion-tokens` | MIT | no | none; loaded in the `arc` cascade layer by `src/styles/globals.css`, which maps Arc's token names onto Deparked's palette, radii and fonts |
| `src/components/arc/button/` | Arc `button` | MIT | yes | `whileTap` and the prop spread typed for `exactOptionalPropertyTypes` |
| `src/components/arc/badge/` | Arc `badge` | MIT | yes | none |
| `src/components/arc/checkbox/` | Arc `checkbox` | MIT | yes | `@radix-ui/react-checkbox` imported from `radix-ui`; no default `aria-label` (call sites label it with `htmlFor`) |
| `src/components/arc/popover/` | Arc `popover` | MIT | yes | Radix import from `radix-ui` |
| `src/components/arc/switch/` | Arc `switch` | MIT | yes | Radix import from `radix-ui`; keyframe options typed for `exactOptionalPropertyTypes` |
| `src/components/arc/tooltip/` | Arc `tooltip` | MIT | yes | Radix import from `radix-ui`; `animate` spread for `exactOptionalPropertyTypes` |
| `src/components/arc/progress/` | Arc `progress` | MIT | yes | none |
| `src/components/arc/toast/` | Arc `toast` | MIT | yes | none |
| `src/components/arc/action-button/` | Arc `action-button` | MIT | yes | none |
| `src/components/arc/alert/` | Arc `alert` | MIT | yes | none |
| `src/components/arc/animated-counter/` | Arc `animated-counter` | MIT | yes | none |
| `src/components/arc/announcement-bar/` | Arc `announcement-bar` | MIT | yes | none |
| `src/components/arc/avatar/` | Arc `avatar` | MIT | yes | none |
| `src/components/arc/bar-chart/` | Arc `bar-chart` | MIT | yes | none |
| `src/components/arc/bottom-sheet/` | Arc `bottom-sheet` | MIT | yes | none |
| `src/components/arc/breadcrumb/` | Arc `breadcrumb` | MIT | yes | none |
| `src/components/arc/button-group/` | Arc `button-group` | MIT | yes | none |
| `src/components/arc/card/` | Arc `card` | MIT | yes | none |
| `src/components/arc/chip-group/` | Arc `chip-group` | MIT | yes | none |
| `src/components/arc/code-block/` | Arc `code-block` | MIT | yes | none |
| `src/components/arc/color-picker/` | Arc `color-picker` | MIT | yes | none |
| `src/components/arc/combobox/` | Arc `combobox` | MIT | yes | none |
| `src/components/arc/command-palette/` | Arc `command-palette` (block) | MIT | yes | none |
| `src/components/arc/confirm-morph/` | Arc `confirm-morph` | MIT | yes | none |
| `src/components/arc/context-menu/` | Arc `context-menu` | MIT | yes | none |
| `src/components/arc/copy-button/` | Arc `copy-button` | MIT | yes | none |
| `src/components/arc/countdown/` | Arc `countdown` | MIT | yes | none |
| `src/components/arc/dialog/` | Arc `dialog` | MIT | yes | none |
| `src/components/arc/drawer/` | Arc `drawer` | MIT | yes | none |
| `src/components/arc/dropdown-menu/` | Arc `dropdown-menu` | MIT | yes | none |
| `src/components/arc/empty-state/` | Arc `empty-state` | MIT | yes | none |
| `src/components/arc/expandable-card/` | Arc `expandable-card` | MIT | yes | none |
| `src/components/arc/expandable-text/` | Arc `expandable-text` | MIT | yes | none |
| `src/components/arc/expanding-search/` | Arc `expanding-search` | MIT | yes | none |
| `src/components/arc/filter-toolbar/` | Arc `filter-toolbar` | MIT | yes | none |
| `src/components/arc/hold-to-confirm/` | Arc `hold-to-confirm` | MIT | yes | none |
| `src/components/arc/hover-card/` | Arc `hover-card` | MIT | yes | none |
| `src/components/arc/inline-edit/` | Arc `inline-edit` | MIT | yes | none |
| `src/components/arc/line-chart/` | Arc `line-chart` | MIT | yes | none |
| `src/components/arc/mention-input/` | Arc `mention-input` | MIT | yes | none |
| `src/components/arc/metric-card/` | Arc `metric-card` | MIT | yes | none |
| `src/components/arc/money-input/` | Arc `money-input` | MIT | yes | none |
| `src/components/arc/number-field/` | Arc `number-field` | MIT | yes | none |
| `src/components/arc/onboarding-checklist/` | Arc `onboarding-checklist` | MIT | yes | none |
| `src/components/arc/pagination/` | Arc `pagination` | MIT | yes | none |
| `src/components/arc/password-field/` | Arc `password-field` | MIT | yes | none |
| `src/components/arc/password-strength/` | Arc `password-strength` | MIT | yes | none |
| `src/components/arc/radio-cards/` | Arc `radio-cards` | MIT | yes | none |
| `src/components/arc/radio-group/` | Arc `radio-group` | MIT | yes | none |
| `src/components/arc/resizable-panels/` | Arc `resizable-panels` | MIT | yes | none |
| `src/components/arc/scroll-area/` | Arc `scroll-area` | MIT | yes | none |
| `src/components/arc/search-field/` | Arc `search-field` | MIT | yes | none |
| `src/components/arc/segmented-control/` | Arc `segmented-control` | MIT | yes | none |
| `src/components/arc/select/` | Arc `select` | MIT | yes | none |
| `src/components/arc/skeleton/` | Arc `skeleton` | MIT | yes | none |
| `src/components/arc/sortable-data-table/` | Arc `sortable-data-table` | MIT | yes | none |
| `src/components/arc/sparkline/` | Arc `sparkline` | MIT | yes | none |
| `src/components/arc/split-button/` | Arc `split-button` | MIT | yes | none |
| `src/components/arc/stepper/` | Arc `stepper` | MIT | yes | none |
| `src/components/arc/tabs/` | Arc `tabs` | MIT | yes | none |
| `src/components/arc/tag-input/` | Arc `tag-input` | MIT | yes | none |
| `src/components/arc/text-morph/` | Arc `text-morph` (dependency of `color-picker`) | MIT | yes | none |
| `src/components/arc/theme-switch/` | Arc `theme-switch` | MIT | yes | none |
| `src/components/arc/timeline/` | Arc `timeline` | MIT | yes | none |
| `src/components/arc/toast-stack/` | Arc `toast-stack` | MIT | yes | none |
| `src/components/arc/toggle-group/` | Arc `toggle-group` | MIT | yes | none |
| `src/components/arc/usage-meter/` | Arc `usage-meter` | MIT | yes | none |
| `src/components/arc/user-menu/` | Arc `user-menu` | MIT | yes | none |
| `src/components/arc/lib/arc-provider.tsx`, `lib/use-copy-feedback.ts` | Arc registry `lib/` files (dependencies of `avatar`, `breadcrumb`, `copy-button`) | MIT | no | none |
| `src/components/arc/input/input.module.css`, `textarea/textarea.module.css` | Arc `input`, `textarea` (stylesheets only) | MIT | no | the `.tsx` files are not copied: Arc's field bundles its label and messages, so `ui/input.tsx` and `ui/textarea.tsx` put its stylesheet on a bare element |
| `src/components/ruixen/spark-chart.tsx` | <https://ruixen.com/r/spark-chart> | MIT | hover only | formatted; index reads typed for `noUncheckedIndexedAccess`; no label room reserved without `formatValue`; draw-in only with `motion-safe` |
| `src/components/ruixen/wizard-stepper.tsx` | <https://ruixen.com/r/wizard-stepper> | MIT | animation and click only | formatted; one prop type widened for `exactOptionalPropertyTypes` |

`src/components/ui/{button,badge,input,textarea,switch,checkbox,popover,tooltip,progress,toast}.tsx` are wrappers over the Arc files: they keep the shadcn export names and props (`variant`, `size`, `asChild`) where call sites use them.

`src/lib/utils.ts` (`cn`) is shadcn/ui's helper, MIT. `src/styles/globals.css` is written for this repo; its token names follow shadcn/ui's theme convention.

The new Arc folders (everything under `src/components/arc/` that is not listed above with changes) are byte-for-byte what `https://uiarc.dev/r/<name>.json` serves, checked on 2026-11-13, and nothing imports them yet. Their `.tsx` files do not pass this repo's `exactOptionalPropertyTypes`, so they are typechecked by `packages/ui/tsconfig.arc.json` (the flag off) and excluded from `tsconfig.json`; Biome's formatter, linter and import sorting are off for the whole `arc/` folder. Arc declares `@radix-ui/react-{dialog,dropdown-menu,popover,select,tabs}`, so `packages/ui` depends on them next to the `radix-ui` package the older Arc files import from. When a component gets used, either type its props for the flag (and record it in "Local changes") or move it out of the exclude list.

## Adding a component

Run from `packages/ui`: `npx shadcn@latest add <name>` or `npx shadcn@latest add "https://ruixen.com/r/<name>"`. Then:

1. Add a row above with the source, licence and the date you checked it. If the licence is unclear, do not add the component.
2. Check its imports. The CLI has written `from "cn"` (and installed the unrelated npm package `cn`) instead of `@deparked/ui/lib/utils`; fix the import and remove the package.
3. Run `pnpm format` and `pnpm check`.

## Notices

### shadcn/ui

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Arc UI

MIT License

Copyright (c) Arc UI (https://uiarc.dev)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Ruixen UI

MIT License

Copyright (c) 2025 Ruixen UI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Arc swap: what stays shadcn, and why

Arc has no free equivalent that fits how the call sites compose these, so they are untouched: `alert-dialog`, `dialog` (only `command` uses it), `command`, `dropdown-menu`, `select`, `radio-group`, `sheet`, `skeleton`, `tabs` (Arc wraps the tab list in its own scroll shell, which breaks the editor grid, where the list is a grid child hidden on wide screens), plus the ones Arc does not have (`alert`, `avatar`, `card`, `field`, `label`, `scroll-area`, `separator`, `table`).
