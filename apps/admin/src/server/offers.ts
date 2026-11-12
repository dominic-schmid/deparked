import {
  type Db,
  listOffers,
  OFFER_STATUSES,
  type Offer,
  type OfferPage,
  type OfferStatus,
  setOfferStatus,
} from "@deparked/db";
import { z } from "zod";
import { decimalAmount } from "../components/format";
import { hostSchema } from "./domains";

const statusSchema = z.enum(OFFER_STATUSES);

/** Which offers a list or an export shows. Both filters are optional. */
export const offerFilterSchema = z.object({
  host: hostSchema.optional(),
  status: statusSchema.optional(),
});
export type OfferFilter = z.infer<typeof offerFilterSchema>;

export const offerPageSchema = offerFilterSchema.extend({
  before: z.object({ createdAt: z.number().int().nonnegative(), id: z.string().min(1).max(64) }).optional(),
});
export type OfferPageInput = z.infer<typeof offerPageSchema>;

export const offerStatusChangeSchema = z.object({ id: z.string().min(1).max(64), status: statusSchema });

export const INBOX_PAGE_SIZE = 25;

function where(filter: OfferFilter): { host?: string; status?: OfferStatus } {
  return {
    ...(filter.host === undefined ? {} : { host: filter.host }),
    ...(filter.status === undefined ? {} : { status: filter.status }),
  };
}

/** One page of the inbox, newest first. Pass the page's `next` back as `before` for the older page. */
export function loadOffers(db: Db, input: OfferPageInput): Promise<OfferPage> {
  return listOffers(db, {
    ...where(input),
    ...(input.before === undefined ? {} : { before: input.before }),
    limit: INBOX_PAGE_SIZE,
  });
}

/** False when no offer has that id. */
export function changeOfferStatus(
  db: Db,
  input: z.infer<typeof offerStatusChangeSchema> & { now: number },
): Promise<boolean> {
  return setOfferStatus(db, input);
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

/** RFC 4180 with a byte order mark, so Excel reads it as UTF-8. */
export function offersCsv(offers: readonly Offer[]): string {
  const rows = offers.map((offer) => [
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
  const lines = [CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

const EXPORT_PAGE_SIZE = 200;
// A Worker on the free plan may run 50 D1 queries per request: the session check takes some, the export the rest.
const EXPORT_MAX_PAGES = 40;

/** Every offer the filter matches, newest first, up to 8,000 (see `EXPORT_MAX_PAGES`). */
export async function exportOffers(db: Db, filter: OfferFilter): Promise<Offer[]> {
  const offers: Offer[] = [];
  let before: OfferPage["next"] = null;
  for (let page = 0; page < EXPORT_MAX_PAGES; page++) {
    const result = await listOffers(db, {
      ...where(filter),
      ...(before === null ? {} : { before }),
      limit: EXPORT_PAGE_SIZE,
    });
    offers.push(...result.offers);
    before = result.next;
    if (before === null) break;
  }
  return offers;
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
