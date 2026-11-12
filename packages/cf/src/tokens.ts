import { z } from "zod";
import { CloudflareApiError, type Http, segment } from "./http";

const verifySchema = z.object({
  id: z.string(),
  status: z.string(),
  expires_on: z.string().optional(),
});

export interface TokenStatus {
  id: string;
  /** "active", "disabled" or "expired". */
  status: string;
  expiresOn: string | undefined;
  /** Which verify endpoint accepted the token. */
  kind: "user" | "account";
}

export interface PermissionProbe {
  /** The permission as the owner sees it on Cloudflare's token page. */
  permission: string;
  call: string;
  path: string;
}

export interface PermissionReport {
  /** Answered 403: the token lacks it. */
  missing: string[];
  /** Answered 404: the probe couldn't tell (for example a zone that has no rules yet). Not proof of access. */
  unknown: string[];
  checked: string[];
}

const anything = z.unknown();

export function tokensApi(http: Http) {
  const account = `/accounts/${http.accountId}`;

  function probes(zoneId: string | undefined): PermissionProbe[] {
    const list: PermissionProbe[] = [
      { permission: "Workers Scripts", call: "check Workers permission", path: `${account}/workers/scripts` },
      { permission: "D1", call: "check D1 permission", path: `${account}/d1/database` },
      { permission: "Turnstile", call: "check Turnstile permission", path: `${account}/challenges/widgets` },
      {
        permission: "Account Settings (Web Analytics)",
        call: "check Web Analytics permission",
        path: `${account}/rum/site_info/list`,
      },
      {
        permission: "Email Routing Addresses",
        call: "check Email Routing addresses permission",
        path: `${account}/email/routing/addresses`,
      },
      { permission: "Zone", call: "check Zone permission", path: "/zones" },
    ];
    if (zoneId === undefined) return list;
    const zone = `/zones/${segment(zoneId)}`;
    return [
      ...list,
      { permission: "Workers Routes", call: "check Workers Routes permission", path: `${zone}/workers/routes` },
      { permission: "DNS", call: "check DNS permission", path: `${zone}/dns_records` },
      {
        permission: "Transform Rules",
        call: "check Transform Rules permission",
        path: `${zone}/rulesets/phases/http_request_transform/entrypoint`,
      },
      {
        permission: "Dynamic Redirect",
        call: "check Redirect Rules permission",
        path: `${zone}/rulesets/phases/http_request_dynamic_redirect/entrypoint`,
      },
      {
        permission: "Zone Settings (Email Routing)",
        call: "check Email Routing permission",
        path: `${zone}/email/routing`,
      },
    ];
  }

  return {
    /**
     * Checks that the token is valid. Tries the user-token endpoint, then the account-token endpoint:
     * 1 request for a user token, 2 for an account-owned token (before retries).
     */
    async verify(): Promise<TokenStatus> {
      const spec = { call: "verify API token", method: "GET" as const };
      try {
        const result = await http.request({ ...spec, path: "/user/tokens/verify" }, verifySchema);
        return { id: result.id, status: result.status, expiresOn: result.expires_on, kind: "user" };
      } catch (error) {
        if (!(error instanceof CloudflareApiError) || (error.status !== 401 && error.status !== 403)) throw error;
        const result = await http.request({ ...spec, path: `${account}/tokens/verify` }, verifySchema);
        return { id: result.id, status: result.status, expiresOn: result.expires_on, kind: "account" };
      }
    },

    /**
     * Cloudflare has no call that lists a token's own permissions without the "API Tokens Read" permission,
     * so this sends one cheap read per permission: 403 means missing, 404 means unknown, any other failure throws.
     * A read can't prove write access: a read-only token passes here and fails on the first write.
     * Exactly 6 requests, 11 with a `zoneId`: probes are never retried.
     */
    async probePermissions(input: { zoneId?: string } = {}): Promise<PermissionReport> {
      const report: PermissionReport = { missing: [], unknown: [], checked: [] };
      for (const probe of probes(input.zoneId)) {
        report.checked.push(probe.permission);
        try {
          await http.request({ call: probe.call, method: "GET", path: probe.path, maxAttempts: 1 }, anything);
        } catch (error) {
          if (!(error instanceof CloudflareApiError)) throw error;
          if (error.status === 403) report.missing.push(probe.permission);
          else if (error.status === 404) report.unknown.push(probe.permission);
          else throw error;
        }
      }
      return report;
    },
  };
}
