import { env } from "cloudflare:workers";
import { createDb } from "@deparked/db";
import { HostingError } from "@deparked/hosting";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { stateSchema } from "../domain-setup/steps";
import { requireSession } from "../require-session";
import { loadUninstallFacts, uninstallWaiverSchema } from "../uninstall";
import { uninstallCopyGate } from "../uninstall-gate";
import { hub, tokenCache } from "./connect";
import { tokenSchema, uninstallConfirmationSchema } from "./hub";

type Failure = { ok: false; credentialsRejected: boolean; message: string };
type Result<T> = { ok: true; value: T } | Failure;

async function guarded<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (!(error instanceof HostingError)) throw error;
    return { ok: false, credentialsRejected: error.credentialsRejected, message: error.message };
  }
}

export const getTokenHealth = createServerFn({ method: "POST" }).handler(async () => {
  await requireSession();
  return guarded(async () => {
    const health = await (await hub()).tokenHealth();
    // What the shell's banner says follows the latest check.
    tokenCache.current = { accepted: health.state !== "rejected", checkedAt: Date.now() };
    return health;
  });
});

/** Checks the pasted token, then stores it as the admin's secret. The token never comes back or reaches a log. */
export const replaceToken = createServerFn({ method: "POST" })
  .validator(tokenSchema)
  .handler(async ({ data }) => {
    await requireSession();
    return guarded(async () => {
      const result = await (await hub(data.token)).replaceToken(data.token);
      // The running admin keeps the old secret until Cloudflare restarts it: let the next check ask again.
      if (result.ok) tokenCache.current = null;
      return result;
    });
  });

/** What Uninstall deletes and keeps, and its steps. Reads the database only. */
export const describeUninstall = createServerFn({ method: "GET" }).handler(async () => {
  await requireSession();
  return guarded(async () => (await hub()).describeUninstall());
});

/**
 * One step of Uninstall per request. The typed confirmation travels with each, so no step runs without it; the
 * first step also needs a copy of the offers, or the owner's word that they need none.
 */
export const uninstallStep = createServerFn({ method: "POST" })
  .validator(z.object({ confirmation: uninstallConfirmationSchema, waived: uninstallWaiverSchema, state: stateSchema }))
  .handler(async ({ data }) => {
    await requireSession();
    if (data.state.next === 0) {
      const gate = uninstallCopyGate(await loadUninstallFacts(createDb(env.DB)), data.waived);
      if (!gate.ok) return { ok: false as const, credentialsRejected: false, message: gate.reason };
    }
    return guarded(async () => (await hub()).uninstallStep(data.state));
  });
