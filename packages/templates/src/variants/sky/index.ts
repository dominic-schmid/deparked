import type { VariantDefinition } from "../types";
import { Page } from "./Page";
import { css } from "./styles.generated";

/** Variant 1: the port of wrappr.app. */
export const sky: VariantDefinition = {
  Page,
  css,
  fonts: [
    { id: "archivo-condensed", preload: true },
    { id: "newsreader", preload: true },
    { id: "archivo" },
    { id: "newsreader-italic" },
  ],
  color: "#7f9fbf",
  contrast: "#ffffff",
};
