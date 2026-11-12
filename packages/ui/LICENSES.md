# Component sources and licences

Every file under `src/components` is copied source, not a runtime dependency. All of it was checked on **2026-11-11**.

## Where the licences were read

- **shadcn/ui**: MIT. `LICENSE.md` in <https://github.com/shadcn-ui/ui>: "Copyright (c) 2023 shadcn".
- **Ruixen UI**: MIT.
  - `LICENSE.md` in <https://github.com/ruixenui/ruixen.com>: "MIT License. Copyright (c) 2025 Ruixen UI".
  - <https://ruixen.com/llms.txt>: "License: MIT".
  - <https://ruixen.com> FAQ: "Ruixen UI is MIT licensed. Use it in personal, commercial, or client projects without restriction. The source is yours once you add it."
  - Only the free registry (`https://ruixen.com/r/<name>`) is used. Ruixen Pro (`pro.ruixen.com`) is a paid product under its own terms and must not be copied here.

Ruixen's registry has no plain primitives (button, input, dialog and so on); it holds composed, animated components. The primitives therefore come from shadcn/ui.

## Files

"Client JS" says whether the component needs hydration to work. All of them render on the server; a lander may use a "yes" component only inside an island.

| File | Source | Licence | Client JS | Local changes |
| -- | -- | -- | -- | -- |
| `src/components/ui/alert-dialog.tsx` | shadcn/ui `alert-dialog` (new-york, `npx shadcn@latest add alert-dialog`) | MIT | yes | formatted |
| `src/components/ui/alert.tsx` | shadcn/ui `alert` (new-york, `npx shadcn@latest add alert`) | MIT | no | formatted |
| `src/components/ui/avatar.tsx` | shadcn/ui `avatar` (new-york, `npx shadcn@latest add avatar`) | MIT | no | formatted |
| `src/components/ui/badge.tsx` | shadcn/ui `badge` (new-york, `npx shadcn@latest add badge`) | MIT | no | formatted |
| `src/components/ui/button.tsx` | shadcn/ui `button` (new-york, `npx shadcn@latest add button`) | MIT | no | formatted |
| `src/components/ui/card.tsx` | shadcn/ui `card` (new-york, `npx shadcn@latest add card`) | MIT | no | formatted |
| `src/components/ui/checkbox.tsx` | shadcn/ui `checkbox` (new-york, `npx shadcn@latest add checkbox`) | MIT | yes | formatted |
| `src/components/ui/command.tsx` | shadcn/ui `command` (new-york, `npx shadcn@latest add command`) | MIT | yes | formatted |
| `src/components/ui/dialog.tsx` | shadcn/ui `dialog` (new-york, `npx shadcn@latest add dialog`) | MIT | yes | formatted |
| `src/components/ui/dropdown-menu.tsx` | shadcn/ui `dropdown-menu` (new-york, `npx shadcn@latest add dropdown-menu`) | MIT | yes | formatted |
| `src/components/ui/field.tsx` | shadcn/ui `field` (new-york, `npx shadcn@latest add field`) | MIT | no | formatted |
| `src/components/ui/input.tsx` | shadcn/ui `input` (new-york, `npx shadcn@latest add input`) | MIT | no | formatted |
| `src/components/ui/label.tsx` | shadcn/ui `label` (new-york, `npx shadcn@latest add label`) | MIT | no | formatted |
| `src/components/ui/popover.tsx` | shadcn/ui `popover` (new-york, `npx shadcn@latest add popover`) | MIT | yes | formatted |
| `src/components/ui/progress.tsx` | shadcn/ui `progress` (new-york, `npx shadcn@latest add progress`) | MIT | no | formatted |
| `src/components/ui/radio-group.tsx` | shadcn/ui `radio-group` (new-york, `npx shadcn@latest add radio-group`) | MIT | yes | formatted |
| `src/components/ui/scroll-area.tsx` | shadcn/ui `scroll-area` (new-york, `npx shadcn@latest add scroll-area`) | MIT | yes | formatted |
| `src/components/ui/select.tsx` | shadcn/ui `select` (new-york, `npx shadcn@latest add select`) | MIT | yes | formatted |
| `src/components/ui/separator.tsx` | shadcn/ui `separator` (new-york, `npx shadcn@latest add separator`) | MIT | no | formatted |
| `src/components/ui/sheet.tsx` | shadcn/ui `sheet` (new-york, `npx shadcn@latest add sheet`) | MIT | yes | formatted |
| `src/components/ui/skeleton.tsx` | shadcn/ui `skeleton` (new-york, `npx shadcn@latest add skeleton`) | MIT | no | formatted |
| `src/components/ui/sonner.tsx` | shadcn/ui `sonner` (new-york, `npx shadcn@latest add sonner`) | MIT | yes | formatted; `next-themes` removed, `theme` is a prop (default `system`) |
| `src/components/ui/switch.tsx` | shadcn/ui `switch` (new-york, `npx shadcn@latest add switch`) | MIT | yes | formatted |
| `src/components/ui/table.tsx` | shadcn/ui `table` (new-york, `npx shadcn@latest add table`) | MIT | no | formatted |
| `src/components/ui/tabs.tsx` | shadcn/ui `tabs` (new-york, `npx shadcn@latest add tabs`) | MIT | yes | formatted |
| `src/components/ui/textarea.tsx` | shadcn/ui `textarea` (new-york, `npx shadcn@latest add textarea`) | MIT | no | formatted |
| `src/components/ui/tooltip.tsx` | shadcn/ui `tooltip` (new-york, `npx shadcn@latest add tooltip`) | MIT | yes | formatted |
| `src/components/ruixen/spark-chart.tsx` | <https://ruixen.com/r/spark-chart> | MIT | hover only | formatted; index reads typed for `noUncheckedIndexedAccess`; no label room reserved without `formatValue`; draw-in only with `motion-safe` |
| `src/components/ruixen/wizard-stepper.tsx` | <https://ruixen.com/r/wizard-stepper> | MIT | animation and click only | formatted; one prop type widened for `exactOptionalPropertyTypes` |

`src/lib/utils.ts` (`cn`) is shadcn/ui's helper, MIT. `src/styles/globals.css` is written for this repo; its token names follow shadcn/ui's theme convention.

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
