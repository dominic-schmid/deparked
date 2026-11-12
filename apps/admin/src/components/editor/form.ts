import type { Config, ConfigErrors } from "@deparked/config";

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

/** Digits with the usual thousands separators ("25,000", "25 000", "25'000") are a number; anything else is left
 * for the schema to reject with its own message. */
function readAmount(text: string): unknown {
  const digits = text.trim().replace(/[\s,'_]/g, "");
  if (digits === "") return undefined;
  return /^-?\d+$/.test(digits) ? Number(digits) : text;
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

/** `parseConfig`'s errors by the input they belong to. Errors without one (`form`, `version`) go to `form`. */
export function errorsByField(errors: ConfigErrors): Partial<Record<FormField | "form", string>> {
  const result: Partial<Record<FormField | "form", string>> = {};
  for (const [path, message] of Object.entries(errors)) {
    const field = ERROR_FIELDS[path] ?? (path in FORM_FIELDS ? (path as FormField) : "form");
    result[field] ??= message;
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

/** The same config, whatever object it came from: what a saved draft is compared by. */
export function configKey(config: Config): string {
  return JSON.stringify(config);
}
