import type { Variant } from "@deparked/config";

/** One encoded size of a background. `path` is absolute on the lander's host (`/catalog/...`), named by `hash`. */
export type CatalogImage = { width: number; path: string; hash: string; bytes: number };

export type CatalogBackground = {
  /** What a config's `background` names. */
  id: string;
  /** Pixel size of the largest source, for the aspect ratio. */
  width: number;
  height: number;
  /** Shown before the image arrives: a flat colour and a few-hundred-byte blurred data URI. */
  color: string;
  placeholder: string;
  /** Where the subject sits, as a CSS `object-position`. */
  position: string;
  /** Narrowest first. */
  formats: { avif: CatalogImage[]; webp: CatalogImage[] };
};

export type CatalogFont = {
  id: string;
  family: string;
  style: "normal" | "italic";
  /** CSS `font-weight` descriptor: one weight or a range (`400 700`). */
  weight: string;
  /** CSS `font-stretch` descriptor, when the face is not normal width. */
  stretch?: string;
  /** SPDX id. */
  license: string;
  files: { subset: string; unicodeRange: string; path: string; hash: string; bytes: number }[];
};

export type CatalogGradient = { id: string; name: string; color: string; css: string };

export type CatalogIsland = { path: string; hash: string; bytes: number };

/** The manifest at `/catalog/catalog.json`: everything a variant can reference, by id, with hashed file paths. */
export type Catalog = {
  version: 1;
  backgrounds: CatalogBackground[];
  fonts: CatalogFont[];
  gradients: CatalogGradient[];
  /** Each variant's hydration bundle; a variant without islands has no entry. */
  islands: Partial<Record<Variant, CatalogIsland>>;
};
