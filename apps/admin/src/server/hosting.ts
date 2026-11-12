import { EmailMessage } from "cloudflare:email";
import { env } from "cloudflare:workers";
import { type HostingAdapter, HostingError } from "@deparked/hosting";
import { createCloudflareHosting } from "@deparked/hosting-cloudflare";
import { hostingConnection } from "./hosting-env";

const SITES_SCRIPT = "deparked-sites";
const ADMIN_SCRIPT = "deparked-admin";

/**
 * The hosting adapter for one request, built from the Worker's environment. Call it inside a handler, never at
 * module scope. `accountId` is `workspace.cf_account_id` when the caller has the row; `CF_ACCOUNT_ID` otherwise.
 */
export function createHosting(input: { accountId?: string | null } = {}): HostingAdapter {
  return createCloudflareHosting({
    ...hostingConnection(env as unknown as Record<string, unknown>, input.accountId),
    sitesScriptName: SITES_SCRIPT,
    adminScriptName: ADMIN_SCRIPT,
    email: { binding: env.EMAIL, EmailMessage },
  });
}

/**
 * The adapter for admin actions that call the hosting API. Throws a `HostingError` the UI can show when the
 * install has no token (local dev without one, for example).
 */
export function getHosting(): HostingAdapter {
  const vars = env as unknown as Record<string, unknown>;
  if (!vars.CF_API_TOKEN || !vars.CF_ACCOUNT_ID) {
    throw new HostingError(
      "credentials-rejected",
      "No Cloudflare token is stored for this install, so Cloudflare cannot be reached.",
    );
  }
  return createHosting();
}
