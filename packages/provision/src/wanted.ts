import type { RedirectRuleInput, RewriteRuleInput } from "@deparked/cf";
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

/**
 * The pages Worker holds every domain's files under `/sites/<host>/`. Two rules map a request into that folder;
 * both only match this one hostname, so other names of the zone are untouched. The pages rule comes first and
 * never matches `/`, the home rule only matches `/`, so neither can apply to the other's result.
 * A rule is recognised by its description: do not change these texts without a migration.
 */
export function wantedRewriteRules(host: string): RewriteRuleInput[] {
  const path = "http.request.uri.path";
  return [
    {
      action: "rewrite",
      description: `Deparked ${host}: pages`,
      expression: `(http.host eq "${host}" and ${path} ne "/" and not starts_with(${path}, "/catalog/") and not starts_with(${path}, "/admin") and not starts_with(${path}, "/api/"))`,
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
