import {
  type Db,
  type Domain,
  getConfig,
  getDomain,
  listDomains,
  listNotifyAddresses,
  listPublishedAt,
  offerStatsForHosts,
} from "@deparked/db";
import { z } from "zod";
import { rangeStart } from "./analytics";

export const hostSchema = z.string().trim().toLowerCase().min(1).max(253);

/** What the admin shows as a domain's state. `email_pending`: live, but its offers cannot be emailed yet. */
export type DisplayStatus = "live" | "draft" | "off" | "error" | "email_pending";

export function displayStatus(
  domain: Pick<Domain, "status" | "notifyEmail">,
  verifiedEmails: ReadonlySet<string>,
): DisplayStatus {
  if (domain.status === "error") return "error";
  if (domain.status === "off" || domain.status === "removed") return "off";
  if (domain.status === "placeholder") return "draft";
  return domain.notifyEmail !== null && verifiedEmails.has(domain.notifyEmail) ? "live" : "email_pending";
}

async function verifiedEmails(db: Db): Promise<Set<string>> {
  const addresses = await listNotifyAddresses(db);
  return new Set(addresses.filter((address) => address.verifiedAt !== null).map((address) => address.email));
}

export type DomainSummary = { host: string; status: DisplayStatus };

/** Every managed domain with its status, by host: the workspace switcher and the command palette. */
export async function loadDomainSummaries(db: Db): Promise<DomainSummary[]> {
  const [domains, verified] = await Promise.all([listDomains(db), verifiedEmails(db)]);
  return domains.map((domain) => ({ host: domain.host, status: displayStatus(domain, verified) }));
}

export type DomainOverview = DomainSummary & {
  offers: number;
  newOffers: number;
  /** Offers over the 30 days the visits cover: the conversion is these over the visits. */
  recentOffers: number;
  /** The largest amount and that offer's currency. Null without offers. Currencies are not converted. */
  best: { amountMinor: number; currency: string } | null;
  publishedAt: number | null;
};

export async function loadOverview(db: Db, now: number): Promise<DomainOverview[]> {
  const [domains, verified, published] = await Promise.all([listDomains(db), verifiedEmails(db), listPublishedAt(db)]);
  const stats = await offerStatsForHosts(
    db,
    domains.map((domain) => domain.host),
    rangeStart(now),
  );
  const statsByHost = new Map(stats.map((stat) => [stat.host, stat]));
  const publishedByHost = new Map(published.map((row) => [row.host, row.publishedAt]));
  return domains.map((domain) => {
    const stat = statsByHost.get(domain.host);
    return {
      host: domain.host,
      status: displayStatus(domain, verified),
      offers: stat?.total ?? 0,
      newOffers: stat?.newCount ?? 0,
      recentOffers: stat?.recentCount ?? 0,
      best: stat === undefined ? null : { amountMinor: stat.bestAmountMinor, currency: stat.bestCurrency },
      publishedAt: publishedByHost.get(domain.host) ?? null,
    };
  });
}

export type DomainDetail = DomainSummary & {
  publishedAt: number | null;
  notifyEmail: string | null;
  notifyVerified: boolean;
};

/** One managed domain. Null for a host that is not managed, or was removed. */
export async function loadDomain(db: Db, host: string): Promise<DomainDetail | null> {
  const domain = await getDomain(db, host);
  if (domain === undefined || domain.status === "removed") return null;
  const [verified, config] = await Promise.all([verifiedEmails(db), getConfig(db, host)]);
  return {
    host: domain.host,
    status: displayStatus(domain, verified),
    publishedAt: config?.publishedAt ?? null,
    notifyEmail: domain.notifyEmail,
    notifyVerified: domain.notifyEmail !== null && verified.has(domain.notifyEmail),
  };
}
