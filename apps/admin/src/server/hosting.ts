import { EmailMessage } from "cloudflare:email";
import { env } from "cloudflare:workers";
import type { HostingAdapter } from "@deparked/hosting";
import { createCloudflareHosting } from "@deparked/hosting-cloudflare";

const SITES_SCRIPT = "deparked-sites";
const ADMIN_SCRIPT = "deparked-admin";

/**
 * The hosting adapter for one request, built from the Worker's environment. Call it inside a handler, never at
 * module scope. `accountId` is `workspace.cf_account_id` when the caller has the row; `CF_ACCOUNT_ID` otherwise.
 * Checking a bot token and sending an email need neither the token nor the account, so the offer API works
 * without them: the placeholder account only makes API calls fail at Cloudflare instead of failing here.
 */
export function createHosting(input: { accountId?: string | null } = {}): HostingAdapter {
  const vars = env as unknown as Record<string, unknown>;
  const text = (name: string) => {
    const value = vars[name];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const baseUrl = text("CLOUDFLARE_API_BASE");
  const botCheckUrl = text("TURNSTILE_VERIFY_URL");
  return createCloudflareHosting({
    token: text("CF_API_TOKEN") ?? "",
    accountId: input.accountId ?? text("CF_ACCOUNT_ID") ?? "unconfigured",
    sitesScriptName: SITES_SCRIPT,
    adminScriptName: ADMIN_SCRIPT,
    getSecret: text,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(botCheckUrl === undefined ? {} : { botCheckUrl }),
    email: { binding: env.EMAIL, EmailMessage },
  });
}
