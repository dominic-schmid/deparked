// Builds the catalog's self-hosted font subsets from the variable fonts Google Fonts serves (pinned versions, the
// same files wrappr.app loads, so the port sets type identically).
// Run by hand when a font changes: `pnpm --filter @deparked/templates catalog:fonts`. The outputs are committed.
// Each face is cut down to the axes the landers use and split into Google's latin and latin-ext ranges.
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";
import type { CatalogFont } from "../src/catalog.ts";
import { updateCatalog } from "./catalog-file.ts";

const SERVED = "https://fonts.gstatic.com/s";
const LICENSES = "https://raw.githubusercontent.com/google/fonts/c30b221beb0c1da59d563feb91ec8656a1fa972a/ofl";
const OUT = fileURLToPath(new URL("../../../apps/sites/public/catalog/fonts/", import.meta.url));

const SUBSETS = {
  latin:
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  "latin-ext":
    "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF",
} as const;

type Axes = Record<string, number | { min: number; max: number }>;
type Subset = keyof typeof SUBSETS;
type Face = Omit<CatalogFont, "files"> & { sources: Record<Subset, string>; axes: Axes };

const ARCHIVO = {
  latin: "archivo/v25/k3kQo8UDI-1M0wlSfdnoLg.woff2",
  "latin-ext": "archivo/v25/k3kQo8UDI-1M0wlSfdfoLnnA.woff2",
};

const FACES: Face[] = [
  {
    id: "archivo-condensed",
    family: "Archivo",
    style: "normal",
    weight: "800",
    stretch: "62%",
    license: "OFL-1.1",
    sources: ARCHIVO,
    axes: { wdth: 62, wght: 800 },
  },
  {
    id: "archivo",
    family: "Archivo",
    style: "normal",
    weight: "400 700",
    stretch: "100%",
    license: "OFL-1.1",
    sources: ARCHIVO,
    axes: { wdth: 100, wght: { min: 400, max: 700 } },
  },
  {
    id: "newsreader",
    family: "Newsreader",
    style: "normal",
    weight: "400",
    license: "OFL-1.1",
    sources: {
      latin: "newsreader/v26/cY9VfjOCX1hbuyalUrK49dLafXjalZCsZBsgBgbNJYQ.woff2",
      "latin-ext": "newsreader/v26/cY9VfjOCX1hbuyalUrK49dLafXjalZCsZBsgBgbDJYQraA.woff2",
    },
    axes: { opsz: { min: 16, max: 72 } },
  },
  {
    id: "newsreader-italic",
    family: "Newsreader",
    style: "italic",
    weight: "400",
    license: "OFL-1.1",
    sources: {
      latin: "newsreader/v26/cY9XfjOCX1hbuyalUrK439vogqCz_goCYw7oRd6JFYYzbA.woff2",
      "latin-ext": "newsreader/v26/cY9XfjOCX1hbuyalUrK439vogqCz_goCYw7oRd6JFYgzbBZD.woff2",
    },
    axes: { opsz: { min: 16, max: 72 } },
  },
];

function textOf(unicodeRange: string): string {
  return unicodeRange
    .split(",")
    .flatMap((range) => {
      const [from = "", to = from] = range.replace("U+", "").split("-");
      const start = Number.parseInt(from, 16);
      return Array.from({ length: Number.parseInt(to, 16) - start + 1 }, (_, i) => String.fromCodePoint(start + i));
    })
    .join("");
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

await mkdir(OUT, { recursive: true });
for (const name of await readdir(OUT)) await rm(`${OUT}${name}`);

const fonts: CatalogFont[] = [];
for (const { sources, axes, ...face } of FACES) {
  const files: CatalogFont["files"] = [];
  for (const [subset, unicodeRange] of Object.entries(SUBSETS) as [Subset, string][]) {
    const served = await download(`${SERVED}/${sources[subset]}`);
    const woff2 = await subsetFont(served, textOf(unicodeRange), { targetFormat: "woff2", variationAxes: axes });
    const hash = createHash("sha256").update(woff2).digest("hex").slice(0, 12);
    const name = `${face.id}-${subset}.${hash}.woff2`;
    await writeFile(`${OUT}${name}`, woff2);
    files.push({ subset, unicodeRange, path: `/catalog/fonts/${name}`, hash, bytes: woff2.length });
  }
  fonts.push({ ...face, files });
}
for (const family of ["archivo", "newsreader"]) {
  await writeFile(`${OUT}OFL-${family}.txt`, await download(`${LICENSES}/${family}/OFL.txt`));
}
await updateCatalog({ fonts });
