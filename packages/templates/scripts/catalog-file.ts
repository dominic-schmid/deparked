// The catalog manifest is one committed file; each build script replaces only its own section.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Catalog } from "../src/catalog.ts";

export const CATALOG_DIR = fileURLToPath(new URL("../../../apps/sites/public/catalog/", import.meta.url));
const FILE = `${CATALOG_DIR}catalog.json`;
const EMPTY: Catalog = { version: 1, backgrounds: [], fonts: [], gradients: [], islands: {} };

export async function readCatalog(): Promise<Catalog> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Catalog;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw error;
  }
}

export async function updateCatalog(sections: Partial<Catalog>): Promise<void> {
  const { version, backgrounds, fonts, gradients, islands } = { ...(await readCatalog()), ...sections };
  await writeFile(FILE, `${JSON.stringify({ version, backgrounds, fonts, gradients, islands }, null, 2)}\n`);
}
