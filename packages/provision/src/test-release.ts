// Test-only: a small release in memory, in the format `scripts/build-release.ts` writes, served by a fake fetch.
import { migrations } from "@deparked/db";
import { PACKS, type PackName, packFileName, RELEASE_FORMAT, type Release, sha256Hex } from "./release";

export interface FakeFile {
  pack: PackName;
  path: string;
  body: string;
  contentType: string;
}

const encoder = new TextEncoder();

export const FAKE_FILES: FakeFile[] = [
  { pack: "catalog", path: "/catalog/catalog.json", body: '{"variants":[]}', contentType: "application/json" },
  { pack: "catalog", path: "/catalog/fonts/a.woff2", body: "font-bytes", contentType: "font/woff2" },
  {
    pack: "admin-modules",
    path: "index.js",
    body: "export default { fetch() {} }",
    contentType: "application/javascript+module",
  },
  {
    pack: "admin-modules",
    path: "admin/_assets/chunk.js",
    body: "export const x = 1",
    contentType: "application/javascript+module",
  },
  { pack: "admin-assets", path: "/admin/_assets/app.js", body: "console.log(1)", contentType: "text/javascript" },
  ...migrations.map((migration) => ({
    pack: "migrations" as const,
    path: migration.name,
    body: migration.sql,
    contentType: "application/sql",
  })),
];

export async function buildFakeRelease(version = "1.0.0", files = FAKE_FILES) {
  const assets = new Map<string, Uint8Array>();
  const listed: Release["files"] = [];
  const packs: Release["packs"] = [];
  for (const pack of PACKS) {
    const parts = files
      .filter((file) => file.pack === pack)
      .map((file) => ({ file, bytes: encoder.encode(file.body) }));
    let offset = 0;
    for (const { file, bytes } of parts) {
      const sha256 = await sha256Hex(bytes);
      listed.push({ ...file, offset, size: bytes.length, sha256, hash: sha256.slice(0, 32) });
      offset += bytes.length;
    }
    const joined = new Uint8Array(offset);
    let at = 0;
    for (const { bytes } of parts) {
      joined.set(bytes, at);
      at += bytes.length;
    }
    packs.push({ name: pack, size: offset });
    assets.set(packFileName({ version }, pack), joined);
  }
  const release: Release = {
    format: RELEASE_FORMAT,
    version,
    minInstallerVersion: "0.1.0",
    catalogFilesUrl: "https://files.example.com/release",
    tokenPermissions: [{ key: "workers_scripts", type: "edit" }],
    packs,
    workers: {
      sites: { compatibilityDate: "2026-11-01", headers: "/*\n  X-Content-Type-Options: nosniff\n" },
      admin: { mainModule: "index.js", compatibilityDate: "2026-11-01", compatibilityFlags: ["nodejs_compat"] },
    },
    files: listed,
  };
  const json = encoder.encode(JSON.stringify(release));
  assets.set("release.json", json);
  const requests: string[] = [];
  const fetch = async (url: string) => {
    requests.push(url);
    const name = url.split("/").at(-1) ?? "";
    const body = assets.get(name);
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body.slice());
  };
  return { release, assets, sha256: await sha256Hex(json), fetch, requests, baseUrl: "https://releases.example.com" };
}
