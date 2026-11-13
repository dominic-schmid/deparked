import type { OfferStatus } from "@deparked/db";
import type { OfferItem } from "../server/offers";
import { formatMoneyShort } from "./format";

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(value: number): string {
  const tens = value % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][value % 10] ?? "th");
  return `${value}${suffix}`;
}

/** "3rd of 5 offers on this domain, best is $8,500": where the offer stands, from the domain's real offers. */
export function offerContextLine(offer: Pick<OfferItem, "amountMinor" | "currency" | "context">): string | null {
  const { context } = offer;
  if (context === null) return null;
  if (context.total <= 1) return "The first offer on this domain";
  const place = `${ordinal(context.ordinal)} of ${context.total} offers on this domain`;
  const isBest = context.bestAmountMinor === offer.amountMinor && context.bestCurrency === offer.currency;
  return isBest
    ? `${place}, and the best`
    : `${place}, best is ${formatMoneyShort(context.bestAmountMinor, context.bestCurrency)}`;
}

/** What the owner can do with an offer besides replying: move it on, or back. */
export const STATUS_ACTIONS: Record<OfferStatus, readonly { status: OfferStatus; label: string }[]> = {
  new: [
    { status: "replied", label: "I already replied" },
    { status: "ignored", label: "Not interested" },
  ],
  replied: [
    { status: "new", label: "Not replied yet" },
    { status: "ignored", label: "Not interested" },
  ],
  ignored: [
    { status: "new", label: "Interested after all" },
    { status: "replied", label: "I already replied" },
  ],
};

/** The question the no-JavaScript status page asks before it saves. */
export const STATUS_QUESTION: Record<OfferStatus, string> = {
  new: "Move this offer back to new?",
  replied: "Mark this offer as replied?",
  ignored: "Not interested in this offer?",
};

/** How an offer that is no longer new reads in its heading. */
export const STATUS_NOTE: Record<OfferStatus, string | null> = {
  new: null,
  replied: "Replied",
  ignored: "Not interested",
};

/** The status filter's options, in the order the control shows them. `all` leaves the URL without `status`. */
export const STATUS_FILTERS: readonly { value: OfferStatus | "all"; label: string }[] = [
  { value: "new", label: "New" },
  { value: "replied", label: "Replied" },
  { value: "ignored", label: "Ignored" },
  { value: "all", label: "All" },
];

const FILTERED_TITLE: Record<OfferStatus, string> = {
  new: "No new offers",
  replied: "No replied offers",
  ignored: "No ignored offers",
};

/** The title of an empty list under a filter: "No new offers for example.com". */
export function filteredEmptyTitle(filter: { status?: OfferStatus | undefined; host?: string | undefined }): string {
  const title = filter.status === undefined ? "No offers" : FILTERED_TITLE[filter.status];
  return filter.host === undefined ? title : `${title} for ${filter.host}`;
}

/** `?offer=`: an offer id (a ULID), or nothing. It is the only buyer-related value a URL ever holds. */
export function offerParam(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9A-Za-z]{1,64}$/.test(value) ? value : undefined;
}
