import { env } from "cloudflare:workers";
import { countNewOffers, createDb } from "@deparked/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { hostSchema, loadDomain, loadDomainSummaries, loadOverview } from "./domains";
import { requireSession } from "./require-session";

/** What every screen of the workspace needs: the domains for the switcher and the inbox badge. */
export const getShell = createServerFn().handler(async () => {
  await requireSession();
  const db = createDb(env.DB);
  const [domains, newOffers] = await Promise.all([loadDomainSummaries(db), countNewOffers(db)]);
  return { domains, newOffers };
});

export const getOverview = createServerFn().handler(async () => {
  await requireSession();
  return { domains: await loadOverview(createDb(env.DB)), now: Date.now() };
});

export const getDomainDetail = createServerFn()
  .validator(z.object({ host: hostSchema }))
  .handler(async ({ data }) => {
    await requireSession();
    return { domain: await loadDomain(createDb(env.DB), data.host), now: Date.now() };
  });

/** Daily visits per host, oldest first. */
export type Visits = Record<string, { last7: number; last30: number; daily: number[] }>;

/**
 * Visits for the overview. Empty until the analytics PR reads them through the hosting adapter; the overview
 * already renders the column from this shape.
 */
export const getAnalytics = createServerFn().handler(async (): Promise<Visits> => {
  await requireSession();
  return {};
});
