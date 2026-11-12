import type { VariantDefinition } from "../types";
import { Page } from "./Page";
import { css } from "./styles.generated";

/** Variant 2: no photo, a grained colour field from the catalog's gradients, the domain across the foot. */
export const gradient: VariantDefinition = {
  Page,
  css,
  fonts: [{ id: "archivo", preload: true }],
  gradient: "dusk",
  color: "#1b2430",
  contrast: "#ffffff",
  onAccent: { ink: "#1c2116", paper: "#ffffff" },
};
