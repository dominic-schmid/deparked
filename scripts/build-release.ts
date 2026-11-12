// Builds a Deparked release into one folder: `release.json` plus one pack per group of files (format in
// packages/provision/src/release.ts). Run `pnpm build:release` (it builds the admin first). CI uploads the folder's
// files to the GitHub Release of the tag; nothing here talks to Cloudflare.
//
//   node scripts/build-release.ts --version 1.2.3 [--out release] [--files-url <base>]
//
// `--files-url` is where the admin re-downloads catalog files (`<base>/catalog/…`, no redirects). Default: the
// repository's committed copy at the tag on raw.githubusercontent.com, which is byte for byte what the pack holds.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { contentHash } from "../packages/hosting/src/index.ts";

const ROOT = resolve(import.meta.dirname, "..");
const FORMAT = 1;
/** Bump when a release needs installer code that older installers lack. */
const MIN_INSTALLER_VERSION = "0.1.0";
/** Fixed, not the CI's repository: the same tag builds the same release.json, so its pinned hash is reproducible. */
const REPOSITORY = "dominic-schmid/deparked";

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    out: { type: "string", default: "release" },
    "files-url": { type: "string" },
  },
});
const version = values.version ?? process.env.GITHUB_REF_NAME?.replace(/^v/, "");
if (version === undefined || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Pass --version x.y.z (or run on a v* tag).");
}
const out = resolve(ROOT, values.out);
const filesUrl = values["files-url"] ?? `https://raw.githubusercontent.com/${REPOSITORY}/v${version}/apps/sites/public`;

const TYPES: Record<string, string> = {
  avif: "image/avif",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
  md: "text/markdown; charset=utf-8",
  png: "image/png",
  sql: "application/sql",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  webp: "image/webp",
  woff2: "font/woff2",
};

function contentType(path: string): string {
  const type = TYPES[/\.([^./]+)$/.exec(path)?.[1] ?? ""];
  if (type === undefined) throw new Error(`No content type known for ${path}: add it to TYPES.`);
  return type;
}

function walk(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function readJsonc(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(text) as Record<string, unknown>;
}

interface Entry {
  pack: string;
  path: string;
  content: Uint8Array;
  contentType: string;
}

const adminServer = resolve(ROOT, "apps/admin/dist/server");
const adminClient = resolve(ROOT, "apps/admin/dist/client");
const adminConfig = JSON.parse(readFileSync(join(adminServer, "wrangler.json"), "utf8")) as {
  main: string;
  compatibility_date: string;
  compatibility_flags?: string[];
};
const sitesConfig = readJsonc(resolve(ROOT, "apps/sites/wrangler.jsonc"));

const entries: Entry[] = [
  ...walk(resolve(ROOT, "apps/sites/public/catalog")).map((file) => ({
    pack: "catalog",
    path: `/${relative(resolve(ROOT, "apps/sites/public"), file)}`,
    content: readFileSync(file),
    contentType: contentType(file),
  })),
  ...walk(adminServer)
    .filter((file) => file.endsWith(".js"))
    .map((file) => ({
      pack: "admin-modules",
      path: relative(adminServer, file),
      content: readFileSync(file),
      contentType: "application/javascript+module",
    })),
  ...walk(adminClient)
    .filter((file) => !file.endsWith(".assetsignore"))
    .map((file) => ({
      pack: "admin-assets",
      path: `/${relative(adminClient, file)}`,
      content: readFileSync(file),
      contentType: contentType(file),
    })),
  ...walk(resolve(ROOT, "packages/db/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .map((file) => ({
      pack: "migrations",
      path: relative(resolve(ROOT, "packages/db/migrations"), file),
      content: readFileSync(file),
      contentType: "application/sql",
    })),
];

const PACKS = ["catalog", "admin-modules", "admin-assets", "migrations"];
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = [];
const packs = [];
for (const pack of PACKS) {
  const members = entries
    .filter((entry) => entry.pack === pack)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (members.length === 0) throw new Error(`Nothing for the ${pack} pack: build the admin first.`);
  let offset = 0;
  for (const entry of members) {
    files.push({
      pack,
      path: entry.path,
      offset,
      size: entry.content.length,
      sha256: createHash("sha256").update(entry.content).digest("hex"),
      hash: await contentHash(entry.path, entry.content),
      contentType: entry.contentType,
    });
    offset += entry.content.length;
  }
  const bytes = Buffer.concat(members.map((entry) => entry.content));
  writeFileSync(join(out, `deparked-${version}-${pack}.pack`), bytes);
  packs.push({ name: pack, size: offset, sha256: createHash("sha256").update(bytes).digest("hex") });
}

const release = {
  format: FORMAT,
  version,
  minInstallerVersion: MIN_INSTALLER_VERSION,
  catalogFilesUrl: filesUrl,
  tokenPermissions: await import("../packages/cf/src/permissions.ts").then(({ TOKEN_PERMISSIONS }) =>
    TOKEN_PERMISSIONS.map(({ key, type }) => ({ key, type })),
  ),
  packs,
  workers: {
    sites: {
      compatibilityDate: String(sitesConfig.compatibility_date),
      headers: readFileSync(resolve(ROOT, "apps/sites/public/_headers"), "utf8"),
    },
    admin: {
      mainModule: adminConfig.main,
      compatibilityDate: adminConfig.compatibility_date,
      compatibilityFlags: adminConfig.compatibility_flags ?? [],
    },
  },
  files,
};
const json = `${JSON.stringify(release, null, 2)}\n`;
writeFileSync(join(out, "release.json"), json);
const sha256 = createHash("sha256").update(json).digest("hex");
writeFileSync(join(out, "release.json.sha256"), `${sha256}  release.json\n`);
const total = packs.reduce((sum, pack) => sum + pack.size, 0);
console.log(
  `Deparked ${version}: ${files.length} files, ${packs.length} packs, ${total} bytes in ${relative(ROOT, out)}/`,
);
console.log(`release.json SHA-256 (pin it in apps/install/src/server/config.ts): ${sha256}`);
