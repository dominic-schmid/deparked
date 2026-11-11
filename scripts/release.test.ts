import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildRelease } from "./release.ts";

test("release.json lists every file with its hash, and each asset holds those bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "release-"));
  mkdirSync(join(root, "apps/admin/dist/server"), { recursive: true });
  mkdirSync(join(root, "packages/db/migrations"), { recursive: true });
  writeFileSync(join(root, "apps/admin/dist/server/index.js"), "export default {}");
  writeFileSync(join(root, "apps/admin/dist/server/index.js.map"), "{}");
  writeFileSync(join(root, "packages/db/migrations/0000_init.sql"), "create table if not exists t (id integer);");
  const out = join(root, "out");

  const release = buildRelease(root, "v0.1.0", out);

  expect(release.files.map((f) => f.path)).toEqual(["admin/server/index.js", "migrations/0000_init.sql"]);
  expect(release.migrations).toEqual(["migrations/0000_init.sql"]);
  for (const file of release.files) {
    const bytes = readFileSync(join(out, file.asset));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    expect(bytes.length).toBe(file.size);
  }
  expect(JSON.parse(readFileSync(join(out, "release.json"), "utf8"))).toEqual(release);
});
