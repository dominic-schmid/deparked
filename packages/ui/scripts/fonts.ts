// Builds the admin's and the installer's two self-hosted typefaces from the variable fonts Google Fonts serves
// (pinned versions), cut down to the axes the interface uses and to Google's latin range.
// Run by hand when a font changes: `pnpm --filter @deparked/ui fonts`. The outputs are committed; `pnpm build:install`
// copies them into the installer, and the admin's stylesheet reads them from there.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const SERVED = "https://fonts.gstatic.com/s";
const LICENSES = "https://raw.githubusercontent.com/google/fonts/c30b221beb0c1da59d563feb91ec8656a1fa972a/ofl";
const OUT = fileURLToPath(new URL("../fonts/", import.meta.url));
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

type Axes = Record<string, number | { min: number; max: number }>;
const FACES: { file: string; source: string; license: string; axes: Axes }[] = [
  {
    // Headings, money and domain names.
    file: "bricolage-grotesque-latin.woff2",
    source: "bricolagegrotesque/v9/3y9K6as8bTXq_nANBjzKo3IeZx8z6up5BeSl9D4dj_x9PpZBMlGIInE.woff2",
    license: "bricolagegrotesque",
    axes: { opsz: { min: 12, max: 96 }, wght: { min: 500, max: 700 } },
  },
  {
    // Everything else.
    file: "instrument-sans-latin.woff2",
    source: "instrumentsans/v4/pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1Q.woff2",
    license: "instrumentsans",
    axes: { wght: { min: 400, max: 700 } },
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
for (const face of FACES) {
  const woff2 = await subsetFont(await download(`${SERVED}/${face.source}`), textOf(LATIN), {
    targetFormat: "woff2",
    variationAxes: face.axes,
  });
  await writeFile(`${OUT}${face.file}`, woff2);
  await writeFile(`${OUT}OFL-${face.license}.txt`, await download(`${LICENSES}/${face.license}/OFL.txt`));
}
