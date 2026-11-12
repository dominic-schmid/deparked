import { env } from "cloudflare:workers";
import { createDb, getWorkspace } from "@deparked/db";
import { HostingError, type HubSetup } from "@deparked/hosting";
import { createCloudflareHubSetup } from "@deparked/hosting-cloudflare";
import { hostingConnection } from "../hosting-env";
import { type TokenCache, tokenRejected } from "./hub";

// Not in `functions.ts`: an exported plain function there would pull `cloudflare:workers` into the client bundle.

export async function hub(): Promise<HubSetup> {
  const db = createDb(env.DB);
  const workspace = await getWorkspace(db);
  const connection = hostingConnection(env as unknown as Record<string, unknown>, workspace?.cfAccountId ?? null);
  if (connection.token === "" || connection.accountId === "unconfigured") {
    throw new HostingError("credentials-rejected", "No Cloudflare token is stored for this install.");
  }
  return createCloudflareHubSetup({
    token: connection.token,
    accountId: connection.accountId,
    ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }),
    db,
    now: Date.now,
  });
}

export const tokenCache: { current: TokenCache } = { current: null };

/** For the shell's banner. Cached per isolate; never throws for Cloudflare. */
export async function shellTokenRejected(): Promise<boolean> {
  let setup: HubSetup;
  try {
    setup = await hub();
  } catch (error) {
    if (error instanceof HostingError) return true;
    throw error;
  }
  return tokenRejected(tokenCache, () => setup, Date.now());
}
