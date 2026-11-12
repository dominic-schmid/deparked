import type { VariantDefinition } from "../types";
import { coverSizes, Page } from "./Page";
import { css } from "./styles.generated";

/** Variant 1: the port of wrappr.app. */
export const sky: VariantDefinition = {
  Page,
  css,
  fonts: [
    { id: "archivo-condensed", preload: true },
    { id: "newsreader", preload: true },
    // The offer sentence sits in the first mobile viewport and reflows when these swap in: preloaded, they are
    // there for the first paint (CLS 0.008 without, against the 0.01 gate).
    { id: "archivo", preload: true },
    { id: "newsreader-italic", preload: true },
  ],
  backgroundSizes: coverSizes,
  color: "#7f9fbf",
  contrast: "#ffffff",
};
