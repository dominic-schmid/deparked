import type { VariantDefinition } from "../types";
import { Page } from "./Page";
import { css } from "./styles.generated";

/** Variant 4: a monochrome spec sheet in one monospaced face, the domain typed out with a caret.
 * Follows the visitor's colour scheme. */
export const mono: VariantDefinition = {
  Page,
  css,
  fonts: [{ id: "jetbrains-mono", preload: true }],
  color: "#f4f4f1",
  darkColor: "#0f0f0e",
  colorScheme: "light dark",
  contrast: "#121211",
  onAccent: { ink: "#121211", paper: "#f4f4f1" },
  accentMarksOn: { light: "#f4f4f1", dark: "#0f0f0e" },
};
