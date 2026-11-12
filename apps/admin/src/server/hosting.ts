import { EmailMessage } from "cloudflare:email";
import { env } from "cloudflare:workers";
import { type HostingAdapter, HostingError } from "@deparked/hosting";
import { createCloudflareHosting, type SendEmailBinding } from "@deparked/hosting-cloudflare";

// The names of the environment contract in the README. They are not in `wrangler.jsonc` (the installer sets
// them), so the generated `Env` does not know them.
type HostingEnv = {
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CLOUDFLARE_API_BASE?: string;
  TURNSTILE_VERIFY_URL?: string;
  EMAIL?: SendEmailBinding;
} & Record<string, unknown>;

/**
 * The one place the admin builds its hosting adapter. Call it per request, never at module scope. Throws a
 * `HostingError` when the install has no token (local dev without one, for example).
 */
export function getHosting(): HostingAdapter {
  const vars = env as unknown as HostingEnv;
  if (!vars.CF_API_TOKEN || !vars.CF_ACCOUNT_ID) {
    throw new HostingError(
      "credentials-rejected",
      "No Cloudflare token is stored for this install, so Cloudflare cannot be reached.",
    );
  }
  return createCloudflareHosting({
    token: vars.CF_API_TOKEN,
    accountId: vars.CF_ACCOUNT_ID,
    sitesScriptName: "deparked-sites",
    adminScriptName: "deparked-admin",
    getSecret: (name) => {
      const value = vars[name];
      return typeof value === "string" ? value : undefined;
    },
    ...(vars.CLOUDFLARE_API_BASE ? { baseUrl: vars.CLOUDFLARE_API_BASE } : {}),
    ...(vars.TURNSTILE_VERIFY_URL ? { botCheckUrl: vars.TURNSTILE_VERIFY_URL } : {}),
    ...(vars.EMAIL ? { email: { binding: vars.EMAIL, EmailMessage } } : {}),
  });
}
