import { env } from "cloudflare:workers";
import { createDb, getWorkspace } from "@deparked/db";
import { HostingError, type HubSetup } from "@deparked/hosting";
import { createCloudflareHubSetup } from "@deparked/hosting-cloudflare";
import { hubConnection, type TokenCache, tokenRejected } from "./hub";

// Not in `functions.ts`: an exported plain function there would pull `cloudflare:workers` into the client bundle.

/** The hub setup on the stored token, or on `token` (Replace token) when one is given. */
export async function hub(token?: string): Promise<HubSetup> {
  const db = createDb(env.DB);
  const workspace = await getWorkspace(db);
  const connection = hubConnection(env as unknown as Record<string, unknown>, workspace?.cfAccountId ?? null, token);
  if (connection === null) {
    throw new HostingError("credentials-rejected", "No Cloudflare token is stored for this install.");
  }
  return createCloudflareHubSetup({ ...connection, db, now: Date.now });
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
