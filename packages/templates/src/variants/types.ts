import type { Config } from "@deparked/config";
import type { ReactElement } from "react";
import type { CatalogBackground } from "../catalog";

export type PageProps = {
  config: Config;
  host: string;
  /** The catalog entry for `config.background`, when it names an image. */
  background: CatalogBackground | undefined;
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
  /** `<meta name="color-scheme">` when the variant commits to one. */
  colorScheme?: "light" | "dark";
};
