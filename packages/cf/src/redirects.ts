import { z } from "zod";
import { type Http, segment } from "./http";

/** A redirect the owner set up outside Deparked, where it is found and what it sends visitors to. */
export interface ForeignRedirect {
  kind: "page-rule" | "bulk-redirect";
  /** The page rule's URL pattern, or the bulk redirect's source URL. */
  source: string;
  target: string;
  /** Bulk redirects: the list that holds it. */
  list?: string;
}

const pageRuleSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  targets: z
    .array(z.object({ constraint: z.object({ value: z.string() }).partial().optional() }))
    .optional()
    .transform((targets) => targets ?? []),
  actions: z
    .array(z.object({ id: z.string(), value: z.unknown().optional() }))
    .optional()
    .transform((actions) => actions ?? []),
});

const redirectRulesetSchema = z.object({
  rules: z
    .array(
      z.object({
        action: z.string().optional(),
        enabled: z.boolean().optional(),
        action_parameters: z.object({ from_list: z.object({ name: z.string() }).optional() }).optional(),
      }),
    )
    .optional()
    .transform((rules) => rules ?? []),
});

const listSchema = z.object({ id: z.string(), name: z.string(), kind: z.string().optional() });
const listItemSchema = z.object({
  redirect: z.object({ source_url: z.string(), target_url: z.string().optional() }).optional(),
});

/** The host of a URL pattern or source URL: `https://www.example.com/a/*` is `www.example.com`. */
function hostOf(pattern: string): string {
  return (pattern.replace(/^[a-z*]+:\/\//i, "").split("/")[0] ?? "").toLowerCase();
}

/** True when a pattern's host is the domain, its `www`, or a wildcard that covers either. */
export function patternCoversHost(pattern: string, host: string): boolean {
  const name = hostOf(pattern);
  const candidates = [host, `www.${host}`];
  if (name.startsWith("*")) return candidates.some((candidate) => candidate.endsWith(name.slice(1)));
  return candidates.includes(name);
}

/**
 * Redirects set up outside Deparked's own redirect rules, which Cloudflare applies before a Worker route ever
 * runs. Page rules read with Zone · Read; bulk redirects need Mass URL Redirects · Read and Account Rule
 * Lists · Read.
 */
export function redirectsApi(http: Http) {
  const account = `/accounts/${http.accountId}`;
  return {
    /** Active page rules of the zone that forward the host. 1 request. */
    async pageRules(zoneId: string, host: string): Promise<ForeignRedirect[]> {
      const rules = await http.request(
        {
          call: "list page rules",
          method: "GET",
          path: `/zones/${segment(zoneId)}/pagerules`,
          query: { status: "active" },
        },
        z.array(pageRuleSchema),
      );
      return rules.flatMap((rule) => {
        const forward = rule.actions.find((action) => action.id === "forwarding_url");
        const source = rule.targets[0]?.constraint?.value ?? "";
        if (forward === undefined || !patternCoversHost(source, host)) return [];
        const url = z.object({ url: z.string() }).safeParse(forward.value);
        return [{ kind: "page-rule" as const, source, target: url.success ? url.data.url : "" }];
      });
    },

    /**
     * Bulk redirects of the account whose source is the host or its `www`. 1 request when none are on,
     * otherwise 2 plus one per list in use.
     */
    async bulkRedirects(host: string): Promise<ForeignRedirect[]> {
      const ruleset = await http.requestOrNull(
        {
          call: "read bulk redirect rules",
          method: "GET",
          path: `${account}/rulesets/phases/http_request_redirect/entrypoint`,
        },
        redirectRulesetSchema,
      );
      const used = new Set(
        (ruleset?.rules ?? [])
          .filter((rule) => rule.action === "redirect" && rule.enabled !== false)
          .flatMap((rule) => rule.action_parameters?.from_list?.name ?? []),
      );
      if (used.size === 0) return [];
      const lists = await http.request(
        { call: "list redirect lists", method: "GET", path: `${account}/rules/lists` },
        z.array(listSchema),
      );
      const found: ForeignRedirect[] = [];
      for (const list of lists.filter((entry) => used.has(entry.name))) {
        const items = await http.request(
          {
            call: "search redirect list",
            method: "GET",
            path: `${account}/rules/lists/${segment(list.id)}/items`,
            query: { search: host, per_page: 100 },
          },
          z.array(listItemSchema),
        );
        for (const item of items) {
          if (item.redirect !== undefined && patternCoversHost(item.redirect.source_url, host)) {
            found.push({
              kind: "bulk-redirect",
              source: item.redirect.source_url,
              target: item.redirect.target_url ?? "",
              list: list.name,
            });
          }
        }
      }
      return found;
    },
  };
}
