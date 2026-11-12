import type { Currency } from "@deparked/config";

/**
 * The offer form contract between every lander variant and `POST /api/offer`. See README "The offer form contract".
 */
export const OFFER_ENDPOINT = "/api/offer";

/** Request field names, the same in a form-encoded and a JSON body. */
export const OFFER_FIELDS = {
  /** Whole major units of the page's currency. JSON: an integer. Form-encoded: digits, grouping characters allowed. */
  amount: "amount",
  name: "name",
  email: "email",
  /** Optional free text. No variant sends it yet. */
  message: "message",
  /** Honeypot: hidden from people. A non-empty value means a bot; answer as if the offer was accepted. */
  honeypot: "website",
  /** Turnstile's token, under Turnstile's own field name. */
  turnstile: "cf-turnstile-response",
} as const;

export const OFFER_LIMITS = { amountDigits: 9, name: 100, email: 200, message: 2000 } as const;

export type OfferField = "amount" | "name" | "email";

/** JSON request body (`content-type: application/json`), sent by the hydrated form. */
export type OfferRequest = {
  amount: number;
  name: string;
  email: string;
  message?: string;
  website: string;
  "cf-turnstile-response": string;
};

/** JSON response. Any 2xx is a success; an error names the field it belongs to, when it belongs to one. */
export type OfferResponse = { ok: true } | { ok: false; error: string; field?: OfferField };

/**
 * A form-encoded request (no JavaScript) is answered with `303 See Other` to `/#offer-sent` or
 * `/#offer-error-<reason>`. The static page shows the matching message with CSS `:target`.
 */
export const OFFER_ERROR_REASONS = ["amount", "name", "email", "check", "rate", "failed"] as const;
export type OfferErrorReason = (typeof OFFER_ERROR_REASONS)[number];
export const OFFER_SENT_FRAGMENT = "offer-sent";
export const offerErrorFragment = (reason: OfferErrorReason) => `offer-error-${reason}`;

// Code-style symbols are followed by a no-break space, so `CHF 1,000` never splits across lines.
const NBSP = String.fromCharCode(0xa0);
const SYMBOLS: Record<Currency, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  CHF: `CHF${NBSP}`,
  CAD: "CA$",
  AUD: "A$",
  SEK: `SEK${NBSP}`,
  NOK: `NOK${NBSP}`,
  DKK: `DKK${NBSP}`,
  PLN: `PLN${NBSP}`,
};

const NAMES: Record<Currency, string> = {
  EUR: "euros",
  USD: "US dollars",
  GBP: "pounds sterling",
  CHF: "Swiss francs",
  CAD: "Canadian dollars",
  AUD: "Australian dollars",
  SEK: "Swedish kronor",
  NOK: "Norwegian kroner",
  DKK: "Danish kroner",
  PLN: "Polish złoty",
};

/** What goes in front of an amount: `€`, `$`, `CHF ` (with a no-break space). */
export const currencySymbol = (currency: Currency): string => SYMBOLS[currency];
export const currencyName = (currency: Currency): string => NAMES[currency];

/** `1500` → `1,500`. Written out so Node, workerd and every browser agree to the byte. */
export const groupDigits = (amount: number): string => String(amount).replace(/\B(?=(\d{3})+$)/g, ",");

export const formatAmount = (amount: number, currency: Currency): string =>
  `${currencySymbol(currency)}${groupDigits(amount)}`;

/** The messages the static page shows after a no-JavaScript submission, by redirect reason. */
export function offerErrorMessages(minOffer: number, currency: Currency): Record<OfferErrorReason, string> {
  return {
    amount: minOffer > 0 ? `Offers start at ${formatAmount(minOffer, currency)}` : "Add an amount",
    name: "Add your name",
    email: "Add an email we can reply to",
    check: "The security check needs JavaScript. Turn it on and send again",
    rate: "Too many offers from here. Try again later",
    failed: "That didn't go through. Try again in a minute",
  };
}
