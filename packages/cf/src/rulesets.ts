import { z } from "zod";
import { CloudflareApiError, type Http } from "./http";

export type RulesetPhase = "http_request_transform" | "http_request_dynamic_redirect";

type ExpressionOrValue = { expression: string } | { value: string };

export interface RewriteRuleInput {
  action: "rewrite";
  expression: string;
  description: string;
  enabled?: boolean;
  action_parameters: { uri: { path: ExpressionOrValue } };
}

export interface RedirectRuleInput {
  action: "redirect";
  expression: string;
  description: string;
  enabled?: boolean;
  action_parameters: {
    from_value: {
      status_code: 301 | 302 | 303 | 307 | 308;
      target_url: ExpressionOrValue;
      preserve_query_string?: boolean;
    };
  };
}

export type RuleInput = RewriteRuleInput | RedirectRuleInput;

const ruleSchema = z.object({
  id: z.string(),
  action: z.string().optional(),
  expression: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  action_parameters: z.unknown().optional(),
});
export type Rule = z.infer<typeof ruleSchema>;

const rulesetSchema = z.object({
  id: z.string(),
  phase: z.string().optional(),
  rules: z
    .array(ruleSchema)
    .optional()
    .transform((rules) => rules ?? []),
});
export type Ruleset = z.infer<typeof rulesetSchema>;

export function rulesetsApi(http: Http) {
  return {
    /** The zone's rule list for a phase, or null when the zone has none yet. */
    getEntrypoint(zoneId: string, phase: RulesetPhase): Promise<Ruleset | null> {
      return http.requestOrNull(
        {
          call: `read ${phase} rules`,
          method: "GET",
          path: `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`,
        },
        rulesetSchema,
      );
    },

    /**
     * Appends one rule and never replaces the list: it posts to the existing ruleset's `/rules`, or, when the
     * zone has no ruleset for the phase, creates one holding only this rule (a create fails if one appeared
     * meanwhile, so a concurrent list is never overwritten). 2 requests (before retries).
     */
    async addRule(zoneId: string, phase: RulesetPhase, rule: RuleInput): Promise<{ rulesetId: string; rule: Rule }> {
      const call = `add ${phase} rule`;
      const existing = await this.getEntrypoint(zoneId, phase);
      const known = new Set(existing?.rules.map((entry) => entry.id));
      const updated =
        existing === null
          ? await http.request(
              {
                call,
                method: "POST",
                path: `/zones/${zoneId}/rulesets`,
                json: { name: "default", kind: "zone", phase, rules: [rule] },
              },
              rulesetSchema,
            )
          : await http.request(
              { call, method: "POST", path: `/zones/${zoneId}/rulesets/${existing.id}/rules`, json: rule },
              rulesetSchema,
            );
      const added = updated.rules.filter((entry) => !known.has(entry.id));
      const created = added.find((entry) => entry.description === rule.description) ?? added.at(-1);
      if (created === undefined) {
        throw new CloudflareApiError({ call, status: 200, detail: "the new rule is missing from the response" });
      }
      return { rulesetId: updated.id, rule: created };
    },

    /** Deletes one rule by id; every other rule in the list stays. */
    async deleteRule(zoneId: string, rulesetId: string, ruleId: string): Promise<void> {
      await http.request(
        { call: "delete rule", method: "DELETE", path: `/zones/${zoneId}/rulesets/${rulesetId}/rules/${ruleId}` },
        z.unknown(),
      );
    },
  };
}
