import { z } from "zod";

export const CONFIG_VERSION = 1;

/** Lander designs. `sky` is variant 1, the port of wrappr.app. */
export const VARIANTS = ["sky", "gradient", "editorial", "mono", "split"] as const;
export type Variant = (typeof VARIANTS)[number];

/** ISO 4217 codes an owner can ask in. Every one has two decimals, see MINOR_UNITS_PER_MAJOR. */
export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** `minOffer` is in whole major units; `offers.amount_minor` is `amount * MINOR_UNITS_PER_MAJOR`. */
export const MINOR_UNITS_PER_MAJOR = 100;

export const SENTENCE_SLOTS = ["amount", "name", "email"] as const;
export type SentenceSlot = (typeof SENTENCE_SLOTS)[number];

export const LIMITS = {
  background: 64,
  headline: 60,
  sentence: 200,
  escrowLine: 160,
  marketplaceUrl: 300,
  seoTitle: 70,
  seoDescription: 200,
  minOffer: 100_000_000,
} as const;

const PLACEHOLDER = /\{[^{}]*\}/g;
const CONTROL = /\p{Cc}|\p{Zl}|\p{Zp}/u;

type CopyOptions = { label: string; max: number; required: boolean; slots?: readonly string[] };

/** One line of owner-written copy: trimmed, length-limited, `{domain}` (and the given slots) as placeholders. */
function copy({ label, max, required, slots = [] }: CopyOptions) {
  const missing = `Add ${label}.`;
  const allowed = new Set(["{domain}", ...slots.map((slot) => `{${slot}}`)]);
  const placeholderHelp =
    slots.length === 0
      ? "The only placeholder you can use here is {domain}."
      : `The placeholders you can use here are {domain}, ${slots.map((slot) => `{${slot}}`).join(", ")}.`;
  return z
    .string({ error: missing })
    .trim()
    .min(required ? 1 : 0, missing)
    .max(max, `Keep this to ${max} characters or fewer.`)
    .refine((text) => !CONTROL.test(text), "Keep this on one line.")
    .refine((text) => (text.match(PLACEHOLDER) ?? []).every((token) => allowed.has(token)), placeholderHelp)
    .refine(
      (text) => slots.every((slot) => text.split(`{${slot}}`).length === 2),
      `Use each of ${slots.map((slot) => `{${slot}}`).join(", ")} exactly once: they become the form fields.`,
    );
}

const hexColor = z
  .string({ error: "Pick a colour." })
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour, like #7f9fbf.")
  .transform((hex) => hex.toLowerCase());

// Host with a dot, no credentials, no whitespace.
const HTTPS_URL = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i;

const emptyAsMissing = (value: unknown) => (value === "" || value === null ? undefined : value);

export const configSchema = z.object({
  version: z.literal(CONFIG_VERSION, {
    error: "This config is from a different version of Deparked. Reload the page and try again.",
  }),
  variant: z.enum(VARIANTS, { error: "Pick one of the designs." }),
  background: z
    .string({ error: "Pick a background." })
    .max(LIMITS.background, "Pick a background from the list.")
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Pick a background from the list."),
  headline: copy({ label: "a headline", max: LIMITS.headline, required: true }),
  sentence: copy({ label: "the offer sentence", max: LIMITS.sentence, required: true, slots: SENTENCE_SLOTS }),
  currency: z.enum(CURRENCIES, { error: "Pick a currency from the list." }),
  minOffer: z
    .number({ error: "Enter the minimum offer as a whole number, like 1000." })
    .int("Enter the minimum offer as a whole number, like 1000.")
    .min(0, "The minimum offer can't be negative.")
    .max(LIMITS.minOffer, `The minimum offer can't be more than ${LIMITS.minOffer.toLocaleString("en-US")}.`),
  escrowLine: copy({ label: "a payment line", max: LIMITS.escrowLine, required: false }),
  marketplaceUrl: z.preprocess(
    emptyAsMissing,
    z
      .string({ error: "Enter a link that starts with https://." })
      .trim()
      .max(LIMITS.marketplaceUrl, `Keep this link to ${LIMITS.marketplaceUrl} characters or fewer.`)
      .regex(HTTPS_URL, "Enter a link that starts with https://.")
      .optional(),
  ),
  seo: z.preprocess(
    (value) => value ?? {},
    z.object(
      {
        title: copy({ label: "a page title", max: LIMITS.seoTitle, required: true }),
        description: copy({ label: "a search description", max: LIMITS.seoDescription, required: true }),
      },
      { error: "Add a page title and a search description." },
    ),
  ),
  accent: z.preprocess(
    emptyAsMissing,
    z.object({ primary: hexColor.optional(), contrast: hexColor.optional() }, { error: "Pick a colour." }).optional(),
  ),
});

export type Config = z.output<typeof configSchema>;
