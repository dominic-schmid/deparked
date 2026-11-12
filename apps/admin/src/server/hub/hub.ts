import type { HubSetup } from "@deparked/hosting";
import { z } from "zod";
import { hostingConnection } from "../hosting-env";

/** A pasted API token: Cloudflare's are 40 characters of letters, digits, `-` and `_`. Never echoed back. */
export const tokenSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, "Paste the whole token: it is about 40 characters long.")
    .max(256, "That is longer than a Cloudflare token.")
    .regex(/^[A-Za-z0-9_-]+$/, "A Cloudflare token has only letters, digits, - and _. Copy it again."),
});

/** The text an owner types to confirm Uninstall. */
export const UNINSTALL_CONFIRMATION = "uninstall deparked";
export const uninstallConfirmationSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((text) => text === UNINSTALL_CONFIRMATION, `Type “${UNINSTALL_CONFIRMATION}” to confirm.`);

/** How long one isolate trusts its last answer about the stored token, so the shell asks Cloudflare rarely. */
export const TOKEN_CHECK_TTL_MS = 5 * 60_000;

export type TokenCache = { accepted: boolean; checkedAt: number } | null;

/**
 * Whether the shell shows the "token rejected" banner. Asks the host at most once per `TOKEN_CHECK_TTL_MS`; an
 * error asking (Cloudflare unreachable) shows no banner and is not remembered.
 */
export async function tokenRejected(
  cache: { current: TokenCache },
  hub: () => Pick<HubSetup, "tokenAccepted">,
  now: number,
): Promise<boolean> {
  const cached = cache.current;
  if (cached !== null && now - cached.checkedAt < TOKEN_CHECK_TTL_MS) return !cached.accepted;
  try {
    const accepted = await hub().tokenAccepted();
    cache.current = { accepted, checkedAt: now };
    return !accepted;
  } catch {
    return false;
  }
}

/**
 * What the hub setup connects with: the stored token, or `token` when one is given (Replace token checks and
 * stores the new one, so it must work while no token, or a dead one, is stored). Null without an account or token.
 */
export function hubConnection(vars: Record<string, unknown>, accountId: string | null, token?: string) {
  const connection = hostingConnection(vars, accountId);
  const chosen = token ?? connection.token;
  if (chosen === "" || connection.accountId === "unconfigured") return null;
  return {
    token: chosen,
    accountId: connection.accountId,
    ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }),
  };
}
