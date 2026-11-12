import { type Db, getWorkspaceMark, listDomains, listOffers, offerStatsForHosts } from "@deparked/db";
import { z } from "zod";
import type { UninstallFacts } from "./uninstall-gate";

/** The owner ticked "I don't need a copy of my offers". */
export const uninstallWaiverSchema = z.boolean();

export async function loadUninstallFacts(db: Db): Promise<UninstallFacts> {
  const [all, managed, newest, exportedAt] = await Promise.all([
    listDomains(db, { includeRemoved: true }),
    listDomains(db),
    listOffers(db, { limit: 1 }),
    getWorkspaceMark(db, "offers-exported"),
  ]);
  const stats = await offerStatsForHosts(
    db,
    all.map((domain) => domain.host),
  );
  return {
    offers: stats.reduce((total, stat) => total + stat.total, 0),
    domains: managed.length,
    newestOfferAt: newest.offers[0]?.createdAt ?? null,
    exportedAt,
  };
}
