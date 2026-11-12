import { env } from "cloudflare:workers";
import { createDb } from "@deparked/db";
import { createServerFn } from "@tanstack/react-start";
import { requireSession } from "./require-session";
import { loadUninstallFacts } from "./uninstall";

/** How many offers and domains Uninstall concerns, and when the offers were last downloaded whole. */
export const getUninstallFacts = createServerFn().handler(async () => {
  await requireSession();
  return { facts: await loadUninstallFacts(createDb(env.DB)), now: Date.now() };
});
