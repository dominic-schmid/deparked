import type { VariantDefinition } from "../types";
import { Page } from "./Page";
import { css } from "./styles.generated";

/** Variant 4: a monochrome spec sheet in one monospaced face, the domain typed out with a caret. */
export const mono: VariantDefinition = {
  Page,
  css,
  fonts: [{ id: "jetbrains-mono", preload: true }],
  color: "#f4f4f1",
  contrast: "#121211",
};
