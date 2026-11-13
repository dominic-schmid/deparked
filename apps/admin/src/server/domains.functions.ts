import { env } from "cloudflare:workers";
import { countNewOffers, createDb, listOffers, setWorkspaceMark } from "@deparked/db";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { homeView } from "../components/home-copy";
import { type AnalyticsSource, loadDomainAnalytics, loadOverviewVisits, workerReportCache } from "./analytics";
import { hostSchema, loadDomain, loadDomainSummaries, loadOverview } from "./domains";
import { getHosting } from "./hosting";
import { shellTokenRejected } from "./hub/connect";
import { requireSession } from "./require-session";
import { loadSetupChecklist } from "./setup-checklist";

/** What every screen of the workspace needs: the domains for the switcher and the inbox badge. */
export const getShell = createServerFn().handler(async () => {
  await requireSession();
  const db = createDb(env.DB);
  const [summaries, newOffers, tokenRejected] = await Promise.all([
    loadDomainSummaries(db),
    countNewOffers(db),
    shellTokenRejected(),
  ]);
  return { ...summaries, newOffers, tokenRejected };
});

/** The home screen: every domain, the setup steps left, the best offer waiting for an answer, the remembered view. */
export const getOverview = createServerFn().handler(async () => {
  await requireSession();
  const now = Date.now();
  const db = createDb(env.DB);
  const [domains, checklist, best] = await Promise.all([
    loadOverview(db, now),
    loadSetupChecklist(db),
    listOffers(db, { status: "new", sort: "highest", limit: 1 }),
  ]);
  const offer = best.offers[0];
  const bestOffer =
    offer === undefined
      ? null
      : {
          host: offer.host,
          name: offer.name,
          email: offer.email,
          country: offer.country,
          amountMinor: offer.amountMinor,
          currency: offer.currency,
          createdAt: offer.createdAt,
        };
  return { domains, checklist, bestOffer, view: homeView(getRequest().headers.get("Cookie")), now };
});

/** Hides the overview's "Finish setting up" card for good. */
export const dismissSetupChecklist = createServerFn({ method: "POST" }).handler(async () => {
  await requireSession();
  await setWorkspaceMark(createDb(env.DB), { mark: "setup-checklist-dismissed", now: Date.now() });
});

export const getDomainDetail = createServerFn()
  .validator(z.object({ host: hostSchema }))
  .handler(async ({ data }) => {
    await requireSession();
    return { domain: await loadDomain(createDb(env.DB), data.host), now: Date.now() };
  });

function analyticsSource(): AnalyticsSource {
  return { hosting: getHosting, cache: workerReportCache };
}

/** Visits for the overview: one Cloudflare read for every domain, cached briefly. Never throws for Cloudflare. */
export const getAnalytics = createServerFn().handler(async () => {
  await requireSession();
  return loadOverviewVisits(createDb(env.DB), analyticsSource(), Date.now());
});

/** One domain's visits, referrers and countries, with its offers over the same days. Null for an unknown host. */
export const getDomainAnalytics = createServerFn()
  .validator(z.object({ host: hostSchema }))
  .handler(async ({ data }) => {
    await requireSession();
    return loadDomainAnalytics(createDb(env.DB), analyticsSource(), data.host, Date.now());
  });
