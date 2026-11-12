import { type Config, type ConfigErrors, parseConfig } from "@deparked/config";
import type { BackgroundOption, BackgroundUse } from "../../server/editor/editor";

/** The editor's inputs, as the owner types them. `fromForm` turns them into a config for `parseConfig`. */
export type EditorForm = {
  variant: string;
  background: string;
  headline: string;
  sentence: string;
  currency: string;
  minOffer: string;
  escrowLine: string;
  marketplaceUrl: string;
  seoTitle: string;
  seoDescription: string;
  /** Off: the variant's own colours. */
  accentOn: boolean;
  accentPrimary: string;
  accentContrast: string;
};

export type FormField = keyof EditorForm;

/** Colours the accent inputs start from when a config has no override: the variant's own. */
export type VariantColors = { color: string; contrast: string };

export function toForm(config: Config, colors: VariantColors): EditorForm {
  return {
    variant: config.variant,
    background: config.background,
    headline: config.headline,
    sentence: config.sentence,
    currency: config.currency,
    minOffer: String(config.minOffer),
    escrowLine: config.escrowLine,
    marketplaceUrl: config.marketplaceUrl ?? "",
    seoTitle: config.seo.title,
    seoDescription: config.seo.description,
    accentOn: config.accent?.primary !== undefined || config.accent?.contrast !== undefined,
    accentPrimary: config.accent?.primary ?? colors.color,
    accentContrast: config.accent?.contrast ?? colors.contrast,
  };
}

/** Plain digits, or digits grouped in threes by one separator used throughout ("25,000", "25.000", "25 000",
 * "1'250'000"). Anything else ("1,5", "12,50") is left as text for the schema to reject: separators are never
 * guessed. */
const GROUPED = /^\d{1,3}([,. '\u00a0\u202f])\d{3}(?:\1\d{3})*$/;

export function readAmount(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return GROUPED.test(trimmed) ? Number(trimmed.replace(/\D/g, "")) : trimmed;
}

/** The form as a config candidate. Unvalidated: `parseConfig` decides. */
export function fromForm(form: EditorForm, version: number): Record<string, unknown> {
  return {
    version,
    variant: form.variant,
    background: form.background,
    headline: form.headline,
    sentence: form.sentence,
    currency: form.currency,
    minOffer: readAmount(form.minOffer),
    escrowLine: form.escrowLine,
    marketplaceUrl: form.marketplaceUrl,
    seo: { title: form.seoTitle, description: form.seoDescription },
    ...(form.accentOn ? { accent: { primary: form.accentPrimary, contrast: form.accentContrast } } : {}),
  };
}

const ERROR_FIELDS: Record<string, FormField> = {
  "seo.title": "seoTitle",
  "seo.description": "seoDescription",
  seo: "seoTitle",
  "accent.primary": "accentPrimary",
  "accent.contrast": "accentContrast",
  accent: "accentPrimary",
};

const FORM_FIELDS: Record<FormField, true> = {
  variant: true,
  background: true,
  headline: true,
  sentence: true,
  currency: true,
  minOffer: true,
  escrowLine: true,
  marketplaceUrl: true,
  seoTitle: true,
  seoDescription: true,
  accentOn: true,
  accentPrimary: true,
  accentContrast: true,
};

/**
 * The config as the form will save it. A stored config the form cannot express exactly (one accent colour set,
 * the other left to the design) comes back with the gap filled in, so loading it is not an unsaved change.
 */
export function normalize(config: Config, colors: VariantColors): Config {
  const parsed = parseConfig(fromForm(toForm(config, colors), config.version));
  return parsed.ok ? parsed.config : config;
}

/** The form fields whose errors these are: an edit to one of them clears its server error. */
export function fieldOf(path: string): FormField | "form" {
  return ERROR_FIELDS[path] ?? (path in FORM_FIELDS ? (path as FormField) : "form");
}

/** `parseConfig`'s errors by the input they belong to. Errors without one (`form`, `version`) go to `form`. */
export function errorsByField(errors: ConfigErrors): Partial<Record<FormField | "form", string>> {
  const result: Partial<Record<FormField | "form", string>> = {};
  for (const [path, message] of Object.entries(errors)) {
    result[fieldOf(path)] ??= message;
  }
  return result;
}

const LABELS: [string, (config: Config) => unknown][] = [
  ["Design", (config) => config.variant],
  ["Background", (config) => config.background],
  ["Headline", (config) => config.headline],
  ["Offer sentence", (config) => config.sentence],
  ["Currency", (config) => config.currency],
  ["Minimum offer", (config) => config.minOffer],
  ["Payment line", (config) => config.escrowLine],
  ["Marketplace link", (config) => config.marketplaceUrl ?? ""],
  ["Page title", (config) => config.seo.title],
  ["Search description", (config) => config.seo.description],
  ["Colours", (config) => `${config.accent?.primary ?? ""} ${config.accent?.contrast ?? ""}`],
];

/** What Publish would change, in the editor's words. Every field when nothing is live yet. */
export function changedFields(draft: Config, live: Config | null): string[] {
  return LABELS.filter(([, read]) => live === null || read(draft) !== read(live)).map(([label]) => label);
}

/** What one side of a change shows: a short text (with the whole of it for the title), or colour swatches. */
export type ChangeValue = { text: string; full: string; colors?: string[] };

/** One field Publish would change, from what is live to what the draft holds. */
export type FieldChange = { label: string; from: ChangeValue; to: ChangeValue };

/** Names for the catalog ids a config holds: the editor knows them from its data. */
export type ChangeNames = { background: (id: string) => string };

const SHORT = 40;

/** At most `max` characters, cut at a word when one ends near the cut, with an ellipsis. */
export function truncate(text: string, max = SHORT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export const variantLabel = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

const text = (value: string, empty = "Empty"): ChangeValue => {
  const full = value.trim() === "" ? empty : value;
  return { text: value.trim() === "" ? empty : `“${truncate(value)}”`, full };
};

const plain = (value: string): ChangeValue => ({ text: value, full: value });

function colors(config: Config): ChangeValue {
  const { primary, contrast } = config.accent ?? {};
  if (primary === undefined || contrast === undefined) return plain("The design's own");
  return {
    text: `${primary} on ${contrast}`,
    full: `Accent ${primary}, text ${contrast}`,
    colors: [primary, contrast],
  };
}

const FIELDS: [string, (config: Config, names: ChangeNames) => ChangeValue][] = [
  ["Design", (config) => plain(variantLabel(config.variant))],
  ["Background", (config, names) => plain(names.background(config.background))],
  ["Headline", (config) => text(config.headline)],
  ["Offer sentence", (config) => text(config.sentence)],
  ["Currency", (config) => plain(config.currency)],
  ["Minimum offer", (config) => plain(`${config.minOffer.toLocaleString("en")} ${config.currency}`)],
  ["Payment line", (config) => text(config.escrowLine)],
  ["Marketplace link", (config) => text(config.marketplaceUrl ?? "", "None")],
  ["Page title", (config) => text(config.seo.title)],
  ["Search description", (config) => text(config.seo.description)],
  ["Colours", (config) => colors(config)],
];

/** What Publish would change, old to new, for a live page. Fields that read the same both ways are left out. */
export function describeChanges(draft: Config, live: Config, names: ChangeNames): FieldChange[] {
  return FIELDS.flatMap(([label, read]) => {
    const from = read(live, names);
    const to = read(draft, names);
    return from.full === to.full && from.text === to.text ? [] : [{ label, from, to }];
  });
}

/** The same config, whatever object it came from: what a saved draft is compared by. */
export function configKey(config: Config): string {
  return JSON.stringify(config);
}

/**
 * The background to keep when the owner picks a variant: the current one if the variant draws that kind, else the
 * variant's own. A variant that draws none keeps it, so switching back restores it.
 */
export function backgroundForVariant(current: string, backgrounds: BackgroundOption[], uses: BackgroundUse): string {
  if (uses === null) return current;
  const kind = backgrounds.find((background) => background.id === current)?.kind;
  return kind === uses.kind ? current : uses.fallback;
}
