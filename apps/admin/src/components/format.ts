// One fixed locale: the server and the browser must format the same text, or hydration would rewrite it.
const LOCALE = "en";

/** Decimal places of a currency's minor unit (USD 2, JPY 0). Unknown codes read as 2. */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** The amount in major units as an exact decimal string, without grouping: `150000` USD → `1500.00`. */
export function decimalAmount(amountMinor: number, currency: string): string {
  const digits = currencyDigits(currency);
  const whole = String(Math.trunc(amountMinor));
  if (digits === 0) return whole;
  const padded = whole.padStart(digits + 1, "0");
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

/** The amount in the offer's own currency. Never converted. */
export function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency }).format(
      amountMinor / 10 ** currencyDigits(currency),
    );
  } catch {
    return `${decimalAmount(amountMinor, currency)} ${currency}`;
  }
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "3 hours ago", relative to `now` (passed in so the server and the browser agree). */
export function relativeTime(time: number, now: number): string {
  const diff = time - now;
  const format = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

/** "Nov 12, 2026, 2:03 PM" in the reader's time zone, or in `timeZone` with its name appended. */
export function absoluteTime(time: number, timeZone?: string): string {
  const text = new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(time);
  return timeZone === undefined ? text : `${text} ${timeZone}`;
}

/** A `mailto:` link answering an offer, with the subject filled in. */
export function replyHref(email: string, host: string): string {
  const address = encodeURIComponent(email).replace(/%40/g, "@");
  return `mailto:${address}?subject=${encodeURIComponent(`Your offer for ${host}`)}`;
}
