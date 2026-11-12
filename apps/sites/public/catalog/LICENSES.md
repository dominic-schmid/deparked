# Catalog sources and licences

Everything under `/catalog` ships in every release and is served by `deparked-sites`. Checked on **2026-11-12**.

## Fonts

Self-hosted subsets, built by `packages/templates/scripts/catalog-fonts.ts` from the variable fonts Google Fonts serves (the pinned URLs are in that script). Each face is cut down to the axes the landers use and split into Google's `latin` and `latin-ext` ranges. No font is loaded from a third party.

| Catalog id | Family | Cut | Licence | Licence text |
| -- | -- | -- | -- | -- |
| `archivo-condensed` | Archivo, © 2020 The Archivo Project Authors (<https://github.com/Omnibus-Type/Archivo>) | width 62, weight 800 | SIL Open Font License 1.1 | [`fonts/OFL-archivo.txt`](fonts/OFL-archivo.txt) |
| `archivo` | Archivo | width 100, weights 400 to 700 | SIL Open Font License 1.1 | [`fonts/OFL-archivo.txt`](fonts/OFL-archivo.txt) |
| `newsreader` | Newsreader, © 2020 The Newsreader Project Authors (<https://github.com/productiontype/Newsreader>) | roman 400, optical sizes 16 to 72 | SIL Open Font License 1.1 | [`fonts/OFL-newsreader.txt`](fonts/OFL-newsreader.txt) |
| `newsreader-italic` | Newsreader | italic 400, optical sizes 16 to 72 | SIL Open Font License 1.1 | [`fonts/OFL-newsreader.txt`](fonts/OFL-newsreader.txt) |

Neither family declares a Reserved Font Name, so the subsets keep the family names. The licence texts were copied from <https://github.com/google/fonts> (`ofl/archivo/OFL.txt`, `ofl/newsreader/OFL.txt`).

## Backgrounds

| Catalog id | Source | Licence |
| -- | -- | -- |
| `sky` | `public/bg.jpg` of the owner's `wrappr-forsale` repository (the photo behind wrappr.app), re-encoded as AVIF and WebP by `packages/templates/scripts/catalog-images.ts` | **To be confirmed by the owner.** The source repository records no author or licence for the photo. |

## Gradients

Written for this repository; no third-party material.

## Island bundles

`islands/<variant>.<hash>.js` is built from `packages/templates` and contains React and React DOM (MIT, © Meta Platforms, Inc. and affiliates).
