// Collects a built release into dist/release/: every file under a content-addressed asset name, plus
// release.json listing each file's path, SHA-256 and size (decision doc section 13). Run after `pnpm build`.
// The bootstrap pins a version and the SHA-256 of its release.json, and verifies every file against it.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";

export type ReleaseFile = { path: string; asset: string; sha256: string; size: number };
export type Release = {
  version: string;
  files: ReleaseFile[];
  migrations: string[];
  tokenPermissions: string[];
};

// What the one pasted token must allow (decision doc section 13, "The token").
const TOKEN_PERMISSIONS = [
  "Workers Scripts: Edit",
  "D1: Edit",
  "Zone: Read",
  "Workers Routes: Edit",
  "Transform Rules: Edit",
  "Dynamic Redirect: Edit",
  "DNS: Read",
  "Turnstile: Edit",
  "Account Analytics: Read",
  "Email Routing Addresses: Edit",
  "Email Routing Rules: Edit",
];

// Release path prefix → directory in the workspace. Missing directories are skipped until their package exists.
const SOURCES: Record<string, string> = {
  "admin/server": "apps/admin/dist/server",
  "admin/client": "apps/admin/dist/client",
  catalog: "apps/sites/public/catalog",
  migrations: "packages/db/migrations",
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    })
    .filter((path) => !/(^|\/)\.gitkeep$|\.map$/.test(path))
    .sort();
}

export function buildRelease(root: string, version: string, outDir: string): Release {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const files: ReleaseFile[] = [];
  for (const [prefix, dir] of Object.entries(SOURCES)) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const bytes = readFileSync(file);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const asset = `${sha256.slice(0, 16)}-${basename(file)}`;
      copyFileSync(file, join(outDir, asset));
      files.push({ path: `${prefix}/${relative(abs, file)}`, asset, sha256, size: statSync(file).size });
    }
  }
  const migrations = files
    .filter((f) => f.path.startsWith("migrations/") && f.path.endsWith(".sql"))
    .map((f) => f.path);
  const release: Release = { version, files, migrations, tokenPermissions: TOKEN_PERMISSIONS };
  writeFileSync(join(outDir, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
  return release;
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version || !/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    console.error("usage: pnpm release v1.2.3");
    process.exit(1);
  }
  const root = join(import.meta.dirname, "..");
  const release = buildRelease(root, version, join(root, "dist/release"));
  console.log(`release ${version}: ${release.files.length} files`);
}
