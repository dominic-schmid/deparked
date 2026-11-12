import type { Config } from "@deparked/config";
import type { ReactElement } from "react";
import type { CatalogBackground, CatalogGradient } from "../catalog";

export type PageProps = {
  config: Config;
  host: string;
  /** The catalog entry for `config.background`, when it names an image. */
  background: CatalogBackground | undefined;
  /** The catalog gradient for `config.background`, or the variant's own default; only for a variant that names one. */
  gradient: CatalogGradient | undefined;
  sitekey: string;
  offerEndpoint: string;
};

export type VariantDefinition = {
  /** Everything inside `<body>`. */
  Page: (props: PageProps) => ReactElement;
  /** The variant's compiled Tailwind CSS (`styles.generated.ts`). */
  css: string;
  /** Catalog font ids the page uses. `preload` the ones the first paint needs. */
  fonts: readonly { id: string; preload?: boolean }[];
  /** `theme-color`, the favicon and the flat colour behind the background, unless the config's accent overrides it
   * (the override also reaches the CSS as `--accent` and `--accent-contrast` on `<html>`). */
  color: string;
  /** The colour of the favicon's letter, unless the config's accent contrast overrides it. */
  contrast: string;
  /**
   * The `sizes` of the background image as the page lays it out, when the photo is what the visitor sees first:
   * the document then preloads the right AVIF candidate. Must match the `sizes` the page puts on its `<img>`.
   */
  backgroundSizes?: (background: CatalogBackground) => string;
  /** A gradient-led variant names the catalog gradient it shows when `config.background` is not one. The gradient's
   * colour then stands in for `color`. */
  gradient?: string;
  /** `theme-color` under a dark colour scheme, for a variant that follows the visitor's. */
  darkColor?: string;
  /** `<meta name="color-scheme">` when the variant commits to one, or `light dark` when it follows the visitor's. */
  colorScheme?: "light" | "dark" | "light dark";
};
