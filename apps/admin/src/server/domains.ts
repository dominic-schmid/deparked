import {
  type Db,
  type Domain,
  getConfig,
  getDomain,
  listDomains,
  listLedger,
  listNotifyAddresses,
  listPublishedAt,
  listSiteFilesByHost,
  type NotifyAddress,
  offerStatsForHosts,
} from "@deparked/db";
import { z } from "zod";
import { rangeStart } from "./analytics";
import { type NoSiteReason, noSiteReason } from "./analytics-shape";
import { type OfferMail, offerMail } from "./notify-default";
import { type PendingChange, pendingChange } from "./pending-change";

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

function verifiedOf(addresses: NotifyAddress[]): Set<string> {
  return new Set(addresses.filter((address) => address.verifiedAt !== null).map((address) => address.email));
}

export type DomainSummary = { host: string; status: DisplayStatus };

/** The address offers go to, for the account menu: a verified one, else the newest added. Null without any. */
export function offersEmail(addresses: Pick<NotifyAddress, "email" | "verifiedAt" | "createdAt">[]): string | null {
  const verified = addresses.find((address) => address.verifiedAt !== null);
  return (verified ?? addresses.toSorted((a, b) => b.createdAt - a.createdAt)[0])?.email ?? null;
}

/** Every managed domain with its status, by host (the domain switcher and search), and the offers address. */
export async function loadDomainSummaries(db: Db): Promise<{ domains: DomainSummary[]; offersEmail: string | null }> {
  const [domains, addresses] = await Promise.all([listDomains(db), listNotifyAddresses(db)]);
  const verified = verifiedOf(addresses);
  return {
    domains: domains.map((domain) => ({ host: domain.host, status: displayStatus(domain, verified) })),
    offersEmail: offersEmail(addresses),
  };
}

export type DomainOverview = DomainSummary & {
  /** Whether its offers are emailed, and if not why. */
  mail: OfferMail;
  /** Why it has no Web Analytics site; null when it has one. */
  noSite: NoSiteReason | null;
  offers: number;
  newOffers: number;
  /** Offers over the 30 days the visits cover: the conversion is these over the visits. */
  recentOffers: number;
  /** The largest amount and that offer's currency. Null without offers. Currencies are not converted. */
  best: { amountMinor: number; currency: string } | null;
  publishedAt: number | null;
};

export async function loadOverview(db: Db, now: number): Promise<DomainOverview[]> {
  const [domains, addresses, published] = await Promise.all([
    listDomains(db),
    listNotifyAddresses(db),
    listPublishedAt(db),
  ]);
  const verified = verifiedOf(addresses);
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
      mail: offerMail(domain.notifyEmail, addresses),
      noSite: domain.analyticsSiteTag === null ? noSiteReason(domain) : null,
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
  /** True while the publish manifest still lists pages of the domain: on, or a turn off that stopped half-way. */
  hasPages: boolean;
  notifyEmail: string | null;
  notifyVerified: boolean;
  mail: OfferMail;
  /** A change to the domain that stopped half-way, or null. */
  pending: PendingChange | null;
};

/** One managed domain. Null for a host that is not managed, or was removed. */
export async function loadDomain(db: Db, host: string): Promise<DomainDetail | null> {
  const domain = await getDomain(db, host);
  if (domain === undefined || domain.status === "removed") return null;
  const [addresses, config, pages, ledger] = await Promise.all([
    listNotifyAddresses(db),
    getConfig(db, host),
    listSiteFilesByHost(db, host),
    listLedger(db, { host }),
  ]);
  const verified = verifiedOf(addresses);
  return {
    host: domain.host,
    status: displayStatus(domain, verified),
    publishedAt: config?.publishedAt ?? null,
    hasPages: pages.length > 0,
    notifyEmail: domain.notifyEmail,
    notifyVerified: domain.notifyEmail !== null && verified.has(domain.notifyEmail),
    mail: offerMail(domain.notifyEmail, addresses),
    pending: pendingChange({ ...domain, ledger, hasPages: pages.length > 0 }),
  };
}
