import {
  type Db,
  getOffer,
  listOffers,
  OFFER_SORTS,
  OFFER_STATUSES,
  type Offer,
  type OfferCursor,
  type OfferPage,
  type OfferStatus,
  offerOrdinals,
  offerStatsForHosts,
  setOfferStatus,
} from "@deparked/db";
import { z } from "zod";
import { decimalAmount } from "../components/format";
import { hostSchema } from "./domains";

const statusSchema = z.enum(OFFER_STATUSES);
export const offerIdSchema = z.string().min(1).max(64);

/** Which offers a list or an export shows. Both filters are optional. */
export const offerFilterSchema = z.object({
  host: hostSchema.optional(),
  status: statusSchema.optional(),
});
export type OfferFilter = z.infer<typeof offerFilterSchema>;

export const offerPageSchema = offerFilterSchema.extend({
  sort: z.enum(OFFER_SORTS).optional(),
  before: z.object({ key: z.number().int().nonnegative(), id: offerIdSchema }).optional(),
  /** The offer the screen shows in full. Read on its own when it is not on this page. */
  selected: offerIdSchema.optional(),
});
export type OfferPageInput = z.infer<typeof offerPageSchema>;

export const offerStatusChangeSchema = z.object({ id: offerIdSchema, status: statusSchema });

export const INBOX_PAGE_SIZE = 25;

function where(filter: OfferFilter): { host?: string; status?: OfferStatus } {
  return {
    ...(filter.host === undefined ? {} : { host: filter.host }),
    ...(filter.status === undefined ? {} : { status: filter.status }),
  };
}

/**
 * Where an offer stands on its domain: the how-manieth it is (1 = the first the domain got), of how many, and the
 * domain's best offer. Amounts in different currencies are compared as stored, as everywhere else.
 */
export type OfferContext = { ordinal: number; total: number; bestAmountMinor: number; bestCurrency: string };

/** An offer as the Offers screen shows it. `context` is null only if the offer vanished while it was read. */
export type OfferItem = Offer & { context: OfferContext | null };

export type OfferItemPage = { offers: OfferItem[]; next: OfferCursor | null };

/** Two queries for any number of offers: their places on their domains, and those domains' totals and best. */
async function withContext(db: Db, list: Offer[]): Promise<OfferItem[]> {
  if (list.length === 0) return [];
  const [ordinals, stats] = await Promise.all([
    offerOrdinals(
      db,
      list.map((offer) => offer.id),
    ),
    offerStatsForHosts(db, [...new Set(list.map((offer) => offer.host))]),
  ]);
  const byHost = new Map(stats.map((stat) => [stat.host, stat]));
  return list.map((offer) => {
    const ordinal = ordinals.get(offer.id);
    const stat = byHost.get(offer.host);
    return {
      ...offer,
      context:
        ordinal === undefined || stat === undefined
          ? null
          : {
              ordinal,
              total: stat.total,
              bestAmountMinor: stat.bestAmountMinor,
              bestCurrency: stat.bestCurrency,
            },
    };
  });
}

/** One page of offers, newest or highest first. Pass the page's `next` back as `before` for the next page. */
export async function loadOffers(db: Db, input: OfferPageInput): Promise<OfferItemPage> {
  const page: OfferPage = await listOffers(db, {
    ...where(input),
    ...(input.sort === undefined ? {} : { sort: input.sort }),
    ...(input.before === undefined ? {} : { before: input.before }),
    limit: INBOX_PAGE_SIZE,
  });
  return { offers: await withContext(db, page.offers), next: page.next };
}

/** One offer with its context, for a link to an offer that is not on the first page. Null when there is none. */
export async function loadOffer(db: Db, id: string): Promise<OfferItem | null> {
  const offer = await getOffer(db, id);
  if (offer === undefined) return null;
  const [item] = await withContext(db, [offer]);
  return item ?? null;
}

/** False when no offer has that id. */
export function changeOfferStatus(
  db: Db,
  input: z.infer<typeof offerStatusChangeSchema> & { now: number },
): Promise<boolean> {
  return setOfferStatus(db, input);
}

// The Offers screens: everything, or one domain's tab. Anything else is not a place to send the owner back to.
const BACK_PATH = /^\/admin\/(?:offers|d\/[a-z0-9.-]+\/offers)(?:\?[\w%=&.-]*)?$/;

/** Where the no-JavaScript status form returns to: the Offers screen it came from, else all offers. */
export function offerBackPath(value: unknown): string {
  return typeof value === "string" && BACK_PATH.test(value) ? value : "/admin/offers";
}

// Excel, Sheets and LibreOffice run a cell that starts with one of these as a formula. Buyers write the cells.
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: defused against formula injection, then quoted when it holds a quote, comma or line break. */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const CSV_COLUMNS = [
  "received_at",
  "domain",
  "amount",
  "currency",
  "name",
  "email",
  "country",
  "message",
  "status",
  "email_status",
  "email_error",
] as const;

const EXPORT_PAGE_SIZE = 200;
// A Worker on the free plan may run 50 D1 queries per request: the session check takes some, the export the rest.
const EXPORT_MAX_PAGES = 40;

/** How many offers one export holds at most. */
export const EXPORT_MAX_OFFERS = EXPORT_PAGE_SIZE * EXPORT_MAX_PAGES;

export type OfferExport = {
  offers: Offer[] /** More offers match the filter than the export holds. */;
  truncated: boolean;
};

/** The offers the filter matches, newest first, up to `maxPages` pages of 200. */
export async function exportOffers(db: Db, filter: OfferFilter, maxPages = EXPORT_MAX_PAGES): Promise<OfferExport> {
  const offers: Offer[] = [];
  let before: OfferPage["next"] = null;
  for (let page = 0; page < maxPages; page++) {
    // `listOffers` reads one row beyond the page, so `next` says whether anything is left.
    const result = await listOffers(db, {
      ...where(filter),
      ...(before === null ? {} : { before }),
      limit: EXPORT_PAGE_SIZE,
    });
    offers.push(...result.offers);
    before = result.next;
    if (before === null) break;
  }
  return { offers, truncated: before !== null };
}

/**
 * RFC 4180 with a byte order mark, so Excel reads it as UTF-8. A truncated export ends with a line that says so,
 * where the owner cannot miss it.
 */
export function offersCsv(data: OfferExport): string {
  const rows = data.offers.map((offer) => [
    new Date(offer.createdAt).toISOString(),
    offer.host,
    decimalAmount(offer.amountMinor, offer.currency),
    offer.currency,
    offer.name,
    offer.email,
    offer.country ?? "",
    offer.message ?? "",
    offer.status,
    offer.emailStatus,
    offer.emailError ?? "",
  ]);
  const notice = data.truncated
    ? [
        [
          `INCOMPLETE EXPORT: this file holds only the newest ${data.offers.length} offers. Older offers are missing. Export one domain or one status at a time to get them all.`,
        ],
      ]
    : [];
  const lines = [CSV_COLUMNS, ...rows, ...notice].map((row) => row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** `offers-example.com-new-2026-11-12.csv`. Hosts hold only letters, digits, dots and hyphens; anything else is dropped. */
export function exportFilename(filter: OfferFilter, now: number): string {
  const parts = [
    "offers",
    filter.host?.replace(/[^a-z0-9.-]/g, ""),
    filter.status,
    new Date(now).toISOString().slice(0, 10),
  ];
  return `${parts.filter(Boolean).join("-")}.csv`;
}
