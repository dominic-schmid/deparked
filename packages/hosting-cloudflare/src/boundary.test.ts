import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The adapter boundary (AGENTS.md "Map"): only these workspace packages may know Cloudflare's API client.
 * `apps/install` is on the list because the installer bundles `@deparked/provision` and `@deparked/cf`.
 */
const MAY_IMPORT_CF = ["packages/cf", "packages/hosting-cloudflare", "packages/provision", "apps/install"];

const ROOT = resolve(import.meta.dirname, "../../..");
const CF_DIR = join(ROOT, "packages", "cf");
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".output", ".wrangler", ".tanstack", ".screenshots"]);
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

type PackageJson = { [Field in (typeof DEPENDENCY_FIELDS)[number]]?: Record<string, string> };

function workspacePackages(): string[] {
  return ["apps", "packages"].flatMap((group) =>
    readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, group, entry.name, "package.json")))
      .map((entry) => `${group}/${entry.name}`),
  );
}

function dependencies(pkg: string): [name: string, range: string][] {
  const json = JSON.parse(readFileSync(join(ROOT, pkg, "package.json"), "utf8")) as PackageJson;
  return DEPENDENCY_FIELDS.flatMap((field) => Object.entries(json[field] ?? {}));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(join(dir, entry.name));
    return SOURCE.test(entry.name) ? [join(dir, entry.name)] : [];
  });
}

/** Every import of a package: `[file, specifier]`. Comments are not stripped, so a commented-out import counts too. */
function imports(pkg: string): [file: string, specifier: string][] {
  return sourceFiles(join(ROOT, pkg)).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(SPECIFIER)].map((match): [string, string] => [file, match[1] ?? ""]),
  );
}

function reachesCf(file: string, specifier: string): boolean {
  if (specifier === "@deparked/cf" || specifier.startsWith("@deparked/cf/")) return true;
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(file), specifier);
  return target === CF_DIR || target.startsWith(CF_DIR + sep);
}

describe("the hosting adapter boundary", () => {
  const packages = workspacePackages();

  it("finds the workspace", () => {
    expect(packages).toEqual(expect.arrayContaining([...MAY_IMPORT_CF, "packages/hosting", "apps/admin"]));
  });

  it("only the adapter, provisioning and the installer depend on or import @deparked/cf", () => {
    const offenders: string[] = [];
    for (const pkg of packages.filter((name) => !MAY_IMPORT_CF.includes(name))) {
      if (dependencies(pkg).some(([name]) => name === "@deparked/cf")) offenders.push(`${pkg}/package.json`);
      for (const [file, specifier] of imports(pkg)) {
        if (reachesCf(file, specifier)) offenders.push(`${relative(ROOT, file)} imports ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("@deparked/hosting has no dependencies and names nothing Cloudflare", () => {
    expect(dependencies("packages/hosting")).toEqual([]);
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "packages/hosting"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(SPECIFIER)) {
        if (!match[1]?.startsWith(".") && match[1] !== "vitest") {
          offenders.push(`${relative(ROOT, file)} imports ${match[1]}`);
        }
      }
      const word = /cloudflare|turnstile|wrangler|workerd/i.exec(text)?.[0];
      if (word !== undefined) offenders.push(`${relative(ROOT, file)} mentions ${word}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the import scan sees static, dynamic, side-effect and relative imports of the client", () => {
    const file = join(ROOT, "apps/admin/src/example.ts");
    const found = (code: string) => [...code.matchAll(SPECIFIER)].some((match) => reachesCf(file, match[1] ?? ""));
    expect(found('import { createCloudflareClient } from "@deparked/cf";')).toBe(true);
    expect(found("import type { Zone } from '@deparked/cf'")).toBe(true);
    expect(found('export * from "@deparked/cf/mock";')).toBe(true);
    expect(found('const cf = await import("@deparked/cf");')).toBe(true);
    expect(found('import "@deparked/cf";')).toBe(true);
    expect(found('const cf = require("@deparked/cf");')).toBe(true);
    expect(found('import { segment } from "../../../packages/cf/src/http";')).toBe(true);
    expect(found('import { HostingError } from "@deparked/hosting";')).toBe(false);
    expect(found('import { x } from "@deparked/cfx";')).toBe(false);
  });

  it("apps/install installs with plain npm: no workspace: dependency", () => {
    expect(dependencies("apps/install").filter(([, range]) => range.startsWith("workspace:"))).toEqual([]);
  });
});
