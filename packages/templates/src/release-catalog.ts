import manifest from "../../../apps/sites/public/catalog/catalog.json" with { type: "json" };
import type { Catalog } from "./catalog";

/**
 * This release's catalog manifest, the same file `deparked-sites` serves at `/catalog/catalog.json`.
 * Pass it to `render` as `options.catalog`.
 */
export const catalog = manifest as Catalog;
