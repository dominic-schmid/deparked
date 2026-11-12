import { z } from "zod";

/**
 * The offer form contract, mirrored from `packages/templates/src/offer.ts` (`OFFER_FIELDS`, `OFFER_LIMITS`) and
 * that package's README "The offer form contract". Import them from `@deparked/templates` once it exports them.
 * These limits are also the gate for the `offers` table: the database has no length checks of its own.
 */
export const OFFER_FIELDS = {
  amount: "amount",
  name: "name",
  email: "email",
  message: "message",
  honeypot: "website",
  turnstile: "cf-turnstile-response",
} as const;
export const OFFER_LIMITS = { amountDigits: 9, name: 100, email: 200, message: 2000 } as const;
const MAX_AMOUNT = 10 ** OFFER_LIMITS.amountDigits - 1;

export type OfferField = "amount" | "name" | "email";
export type OfferFields = { amount: number; name: string; email: string; message?: string };

const CONTROL = /\p{Cc}|\p{Zl}|\p{Zp}/u;
const CONTROL_EXCEPT_NEWLINE_AND_TAB = /[^\P{Cc}\n\t]|\p{Zl}|\p{Zp}/u;
const DIGITS = /^\d+$/;
/** `1,500`, `1.500`, `1 500`, `1'500`. `1500.50` is not grouping and is refused, not read as 150050. */
const GROUPED = /^\d{1,3}(?:[,.'   ]\d{3})+$/;
/** Deliberately narrower than RFC 5322: an ASCII local part and a dotted hostname. No quotes, no comments. */
const EMAIL =
  /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Whole major units: a JSON integer, or the form's text with optional grouping characters. */
function toAmount(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (DIGITS.test(text)) return Number(text);
  if (GROUPED.test(text)) return Number(text.replace(/\D/g, ""));
  return Number.NaN;
}

function toMessage(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return value;
  const text = value.replace(/\r\n?/g, "\n").trim();
  return text === "" ? undefined : text;
}

const offerSchema = z.object({
  amount: z.preprocess(toAmount, z.number().int().min(1).max(MAX_AMOUNT)),
  name: z
    .string()
    .trim()
    .min(1)
    .max(OFFER_LIMITS.name)
    .refine((value) => !CONTROL.test(value)),
  email: z.string().trim().max(OFFER_LIMITS.email).regex(EMAIL),
  message: z.preprocess(
    toMessage,
    z
      .string()
      .max(OFFER_LIMITS.message)
      .refine((value) => !CONTROL_EXCEPT_NEWLINE_AND_TAB.test(value))
      .optional(),
  ),
});

const FIELDS: readonly OfferField[] = ["amount", "name", "email"];

export type ParsedOffer = { ok: true; fields: OfferFields } | { ok: false; field?: OfferField };

/** Validates the buyer's input. On failure names the first bad field in form order; none when it is the message. */
export function parseOfferFields(input: Record<string, unknown>): ParsedOffer {
  const result = offerSchema.safeParse(input);
  if (result.success) {
    const { message, ...rest } = result.data;
    return { ok: true, fields: message === undefined ? rest : { ...rest, message } };
  }
  const bad = new Set(result.error.issues.map((issue) => issue.path[0]));
  const field = FIELDS.find((name) => bad.has(name));
  return field === undefined ? { ok: false } : { ok: false, field };
}
