// Encodes the catalog's backgrounds from assets/backgrounds/<id>.jpg as AVIF and WebP in responsive widths,
// named by content hash. Run by hand when a source image changes: `pnpm --filter @deparked/templates catalog:images`.
// The outputs are committed: encoders differ between platforms, so CI does not rebuild them.
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { CatalogBackground, CatalogImage } from "../src/catalog.ts";
import { CATALOG_DIR, updateCatalog } from "./catalog-file.ts";

const SOURCES = fileURLToPath(new URL("../assets/backgrounds/", import.meta.url));
const OUT = `${CATALOG_DIR}backgrounds/`;
const WIDTHS = [640, 960, 1280, 1672];

// `color` is the flat fallback the page paints first; `position` keeps the subject in frame when the image is cropped.
const BACKGROUNDS = [{ id: "sky", color: "#7f9fbf", position: "center 30%" }];

await mkdir(OUT, { recursive: true });
for (const name of await readdir(OUT)) await rm(`${OUT}${name}`);

const backgrounds: CatalogBackground[] = [];
for (const { id, color, position } of BACKGROUNDS) {
  const source = sharp(`${SOURCES}${id}.jpg`);
  const { width = 0, height = 0 } = await source.metadata();
  const formats: CatalogBackground["formats"] = { avif: [], webp: [] };
  for (const target of WIDTHS.filter((candidate) => candidate <= width)) {
    const resized = source.clone().resize({ width: target });
    const encoded = {
      avif: await resized.clone().avif({ quality: 50, effort: 9 }).toBuffer(),
      webp: await resized.clone().webp({ quality: 72, effort: 6 }).toBuffer(),
    };
    for (const [format, bytes] of Object.entries(encoded) as [keyof typeof encoded, Buffer][]) {
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
      const name = `${id}-${target}.${hash}.${format}`;
      await writeFile(`${OUT}${name}`, bytes);
      const image: CatalogImage = { width: target, path: `/catalog/backgrounds/${name}`, hash, bytes: bytes.length };
      formats[format].push(image);
    }
  }
  const tiny = await source.clone().resize({ width: 24 }).blur(1).webp({ quality: 40 }).toBuffer();
  backgrounds.push({
    id,
    width,
    height,
    color,
    placeholder: `data:image/webp;base64,${tiny.toString("base64")}`,
    position,
    formats,
  });
}
await updateCatalog({ backgrounds });
