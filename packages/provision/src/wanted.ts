import type { RedirectRuleInput, RewriteRuleInput, WorkerRoute } from "@deparked/cf";
import type { WorkerNames } from "./context";

/** What a hostname without a server behind it needs to resolve through Cloudflare: a proxied discard address. */
export const PLACEHOLDER_RECORD = { type: "AAAA", content: "100::" } as const;

export const ADDRESS_RECORD_TYPES: readonly string[] = ["A", "AAAA", "CNAME"];

export interface WantedRoute {
  pattern: string;
  script: string;
  target: "sites" | "admin";
}

/** The admin patterns are more specific than the pages' catch-all, so Cloudflare prefers them. */
export function wantedRoutes(host: string, workers: WorkerNames): WantedRoute[] {
  return [
    { pattern: `${host}/*`, script: workers.sites, target: "sites" },
    { pattern: `${host}/admin*`, script: workers.admin, target: "admin" },
    { pattern: `${host}/api/*`, script: workers.admin, target: "admin" },
  ];
}

/** True when a route pattern answers on the host itself (not only on `www` or another name). */
export function coversApex(pattern: string, host: string): boolean {
  const name = pattern.split("/")[0] ?? "";
  return name.startsWith("*") ? host.endsWith(name.slice(1)) : name === host;
}

/** A path of the host that stays the owner's: the rewrite must not touch it. */
export interface PathExclusion {
  kind: "prefix" | "exact";
  path: string;
}

const SAFE_PATH = /^\/[A-Za-z0-9._~/-]+$/;

/**
 * The owner's Worker routes on the host are more specific than Deparked's catch-all, so their Workers keep
 * getting those requests. The rewrite runs before any Worker, though, and would change their paths. Each such
 * route becomes an exclusion of the rewrite rule: `/shop*` a prefix, `/health` an exact path. A pattern that
 * cannot be written safely into a rule expression (a wildcard in the middle, unusual characters, the whole
 * host) is returned as `inexpressible`: the attach then stops instead of guessing.
 */
export function pathExclusions(
  routes: readonly WorkerRoute[],
  host: string,
): { exclusions: PathExclusion[]; inexpressible: WorkerRoute[] } {
  const exclusions: PathExclusion[] = [];
  const inexpressible: WorkerRoute[] = [];
  for (const route of routes) {
    if (!coversApex(route.pattern, host)) continue;
    const path = route.pattern.slice((route.pattern.split("/")[0] ?? "").length);
    const prefix = path.endsWith("*") ? path.slice(0, -1) : undefined;
    if (prefix !== undefined && SAFE_PATH.test(prefix)) exclusions.push({ kind: "prefix", path: prefix });
    else if (prefix === undefined && SAFE_PATH.test(path)) exclusions.push({ kind: "exact", path });
    else inexpressible.push(route);
  }
  return { exclusions, inexpressible };
}

/**
 * The pages Worker holds every domain's files under `/sites/<host>/`. Two rules map a request into that folder;
 * both only match this one hostname, so other names of the zone are untouched. The pages rule comes first and
 * never matches `/`, the home rule only matches `/`, so neither can apply to the other's result.
 */
export function wantedRewriteRules(host: string, excluded: readonly PathExclusion[]): RewriteRuleInput[] {
  const path = "http.request.uri.path";
  const owners = excluded
    .map((entry) =>
      entry.kind === "prefix" ? ` and not starts_with(${path}, "${entry.path}")` : ` and ${path} ne "${entry.path}"`,
    )
    .join("");
  return [
    {
      action: "rewrite",
      description: `Deparked ${host}: pages`,
      expression: `(http.host eq "${host}" and ${path} ne "/" and not starts_with(${path}, "/catalog/") and not starts_with(${path}, "/admin") and not starts_with(${path}, "/api/")${owners})`,
      action_parameters: { uri: { path: { expression: `concat("/sites/", http.host, ${path})` } } },
    },
    {
      action: "rewrite",
      description: `Deparked ${host}: home page`,
      expression: `(http.host eq "${host}" and ${path} eq "/")`,
      action_parameters: { uri: { path: { value: `/sites/${host}/index.html` } } },
    },
  ];
}

export function wantedRedirectRules(host: string): RedirectRuleInput[] {
  return [
    {
      action: "redirect",
      description: `Deparked ${host}: www to ${host}`,
      expression: `(http.host eq "www.${host}")`,
      action_parameters: {
        from_value: {
          status_code: 301,
          target_url: { expression: `concat("https://${host}", http.request.uri.path)` },
          preserve_query_string: true,
        },
      },
    },
  ];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  );
}

/** True when an existing rule does exactly what the wanted one does. */
export function sameRule(
  existing: { action?: string | undefined; expression?: string | undefined; action_parameters?: unknown },
  wanted: RewriteRuleInput | RedirectRuleInput,
): boolean {
  return (
    existing.action === wanted.action &&
    existing.expression === wanted.expression &&
    sameValue(existing.action_parameters, wanted.action_parameters)
  );
}

export function ruleConflictReason(host: string, description: string): string {
  return `A rule named "${description}" already exists on ${host} but does something else. Deparked did not create it and will not touch it. Rename or remove it in Cloudflare (Rules), then try again.`;
}
