import type { VariantDefinition } from "../types";
import { Page } from "./Page";
import { css } from "./styles.generated";

/** Variant 3: a printed front page, paper and ink, the domain as its masthead. Follows the visitor's colour scheme. */
export const editorial: VariantDefinition = {
  Page,
  css,
  fonts: [{ id: "newsreader", preload: true }, { id: "newsreader-italic" }, { id: "archivo" }],
  color: "#f4efe6",
  darkColor: "#15130f",
  colorScheme: "light dark",
  contrast: "#1a1714",
};
