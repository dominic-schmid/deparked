import type { Variant } from "@deparked/config";
import { sky } from "./sky";
import type { VariantDefinition } from "./types";

/**
 * Every lander design, by the config's `variant`. Adding one is a folder under `variants/` and a line here.
 * A variant the schema names but no folder implements yet renders as Sky.
 */
export const variants: Partial<Record<Variant, VariantDefinition>> & { sky: VariantDefinition } = {
  sky,
};

export function resolveVariant(variant: Variant): { id: Variant; definition: VariantDefinition } {
  const definition = variants[variant];
  return definition ? { id: variant, definition } : { id: "sky", definition: variants.sky };
}
