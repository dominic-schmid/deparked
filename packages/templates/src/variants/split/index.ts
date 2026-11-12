import type { VariantDefinition } from "../types";
import { Page, photoSizes } from "./Page";
import { css } from "./styles.generated";

/** Variant 5: a diptych, the photo on one half and a solid panel with the domain in italic serif on the other. */
export const split: VariantDefinition = {
  Page,
  css,
  fonts: [
    { id: "newsreader-italic", preload: true },
    { id: "archivo", preload: true },
  ],
  backgroundSizes: photoSizes,
  color: "#1f2918",
  contrast: "#f2ede1",
  colorScheme: "dark",
};
