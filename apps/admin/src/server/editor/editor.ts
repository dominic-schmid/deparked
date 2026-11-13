import {
  type Config,
  type ConfigErrors,
  defaultConfig,
  migrateConfig,
  parseConfig,
  VARIANTS,
  type Variant,
} from "@deparked/config";
import { type Db, getConfig, getDeployment, getDomain, listConfigHistory } from "@deparked/db";
import { type Catalog, render, variants } from "@deparked/templates";
import { getPublishState, type PublishState } from "../publish/pipeline";

/** Cloudflare's documented always-pass test sitekey. The preview never loads Turnstile; this keeps real keys out. */
export const PREVIEW_SITEKEY = "1x00000000000000000000AA";

/** The preview re-renders while the owner types: entrance animations would replay on every change. */
const PREVIEW_STYLE = "<style>*,::before,::after{animation-delay:0s!important;animation-duration:0s!important}</style>";

/**
 * The page's own policy, next to the iframe's empty `sandbox`: no script, no form, no requests but the catalog's
 * images and fonts from `origin`. The srcdoc document also inherits the admin page's policy.
 */
function previewPolicy(origin: string): string {
  return [
    "default-src 'none'",
    `img-src ${origin} data:`,
    `font-src ${origin}`,
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export type PreviewResult = { ok: true; html: string } | { ok: false; errors: ConfigErrors };

/**
 * The lander for an unsaved draft, exactly as `render` publishes it, made inert for an iframe. `origin` is the
 * admin page's origin, which serves `/catalog/*` (a managed domain through the pages Worker, the admin's own
 * address from its own assets). Never writes anything.
 */
export function renderPreview(
  input: { catalog: Catalog },
  host: string,
  config: unknown,
  origin: string,
): PreviewResult {
  const parsed = parseConfig(config);
  if (!parsed.ok) return parsed;
  const html = render(parsed.config, host, { catalog: input.catalog, sitekey: PREVIEW_SITEKEY })["index.html"];
  const head = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(previewPolicy(origin))}">`;
  return { ok: true, html: html.replace("<head>", `<head>${head}`).replace("</head>", `${PREVIEW_STYLE}</head>`) };
}

/** `value` when it is exactly an http(s) origin (`https://example.com`, `http://localhost:5173`), else null. */
export function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value ? value : null;
  } catch {
    return null;
  }
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/**
 * The kind of background a variant draws and the one it falls back to; null for a variant that draws none. A
 * background of another kind is ignored by `render()`.
 */
export type BackgroundUse = { kind: "image" | "gradient"; fallback: string } | null;
export type VariantOption = {
  id: Variant;
  available: boolean;
  color: string;
  contrast: string;
  uses: BackgroundUse;
};
export type BackgroundOption = {
  id: string;
  kind: "image" | "gradient";
  label: string;
  /** A CSS `background` for the swatch: the image's blurred placeholder or the gradient. Catalog data only. */
  swatch: string;
};
export type HistoryItem = { id: number; publishedAt: number; variant: string; headline: string };

export type LockHolder = { deploymentId: number; host: string | null; startedAt: number };
export type EditorPublishState = PublishState & { holder: LockHolder | null };

export type EditorData = {
  host: string;
  /** What the form starts from: the saved draft, else the live config, else the defaults. */
  draft: Config;
  /** True when `draft` is stored as the draft; false when the editor starts from live or defaults. */
  draftStored: boolean;
  live: Config | null;
  /** Set when the stored draft could not be read and the editor starts from something else. */
  notice: string | null;
  variants: VariantOption[];
  backgrounds: BackgroundOption[];
  history: HistoryItem[];
  publish: EditorPublishState;
  now: number;
};

function readStored(json: string | null | undefined): Config | null | "unreadable" {
  if (json === null || json === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return "unreadable";
  }
  const result = migrateConfig(value);
  return result.ok ? result.config : "unreadable";
}

const titleCase = (id: string) => id.charAt(0).toUpperCase() + id.slice(1).replaceAll("-", " ");

/** Every variant the schema names; `available` when this release's templates implement it. */
export function variantOptions(catalog: Catalog): VariantOption[] {
  const photo = catalog.backgrounds[0]?.id;
  return VARIANTS.map((id) => {
    const definition = variants[id] ?? variants.sky;
    const uses: BackgroundUse = definition.gradient
      ? { kind: "gradient", fallback: definition.gradient }
      : definition.backgroundSizes && photo !== undefined
        ? { kind: "image", fallback: photo }
        : null;
    return { id, available: variants[id] !== undefined, color: definition.color, contrast: definition.contrast, uses };
  });
}

export function backgroundOptions(catalog: Catalog): BackgroundOption[] {
  return [
    ...catalog.backgrounds.map(
      (background): BackgroundOption => ({
        id: background.id,
        kind: "image",
        label: titleCase(background.id),
        swatch: `${background.color} url("${background.placeholder}") ${background.position} / cover`,
      }),
    ),
    ...catalog.gradients.map(
      (gradient): BackgroundOption => ({
        id: gradient.id,
        kind: "gradient",
        label: gradient.name,
        swatch: gradient.css,
      }),
    ),
  ];
}

export async function loadPublishState(
  input: { db: Db; now: () => number },
  host: string,
): Promise<EditorPublishState> {
  const state = await getPublishState(input, host);
  if (state.lock === null) return { ...state, holder: null };
  const deployment = await getDeployment(input.db, state.lock.deploymentId);
  return {
    ...state,
    holder: {
      deploymentId: state.lock.deploymentId,
      host: deployment?.host ?? null,
      startedAt: deployment?.startedAt ?? state.lock.expiresAt,
    },
  };
}

export type Thumbnail = { html: string; source: "live" | "draft" | "default" };

/**
 * The domain's page for the home screen's window: the live page, else the draft before the first publish, else the
 * defaults. Rendered as the editor's preview is. Null for a host that is not managed (or a config that cannot render).
 */
export async function loadThumbnail(
  input: { db: Db; catalog: Catalog },
  host: string,
  origin: string,
): Promise<Thumbnail | null> {
  const domain = await getDomain(input.db, host);
  if (domain === undefined || domain.status === "removed") return null;
  const stored = await getConfig(input.db, host);
  const live = readStored(stored?.liveJson);
  const draft = readStored(stored?.draftJson);
  const [config, source]: [Config, Thumbnail["source"]] =
    live !== null && live !== "unreadable"
      ? [live, "live"]
      : draft !== null && draft !== "unreadable"
        ? [draft, "draft"]
        : [defaultConfig(), "default"];
  const preview = renderPreview(input, host, config, origin);
  return preview.ok ? { html: preview.html, source } : null;
}

/** Everything the editor of one domain starts from. Null for a host that is not managed. */
export async function loadEditor(
  input: { db: Db; catalog: Catalog; now: () => number },
  host: string,
): Promise<EditorData | null> {
  const domain = await getDomain(input.db, host);
  if (domain === undefined || domain.status === "removed") return null;
  const [stored, entries, publish] = await Promise.all([
    getConfig(input.db, host),
    listConfigHistory(input.db, { host, limit: 20 }),
    loadPublishState(input, host),
  ]);
  const draft = readStored(stored?.draftJson);
  const live = readStored(stored?.liveJson);
  const liveConfig = live === "unreadable" ? null : live;
  const start = draft !== null && draft !== "unreadable" ? draft : (liveConfig ?? defaultConfig());
  return {
    host,
    draft: start,
    draftStored: draft !== null && draft !== "unreadable",
    live: liveConfig,
    notice:
      draft === "unreadable"
        ? `The saved draft could not be read, so the editor starts from ${liveConfig ? "the live page" : "the defaults"}. Your next change replaces it.`
        : null,
    variants: variantOptions(input.catalog),
    backgrounds: backgroundOptions(input.catalog),
    history: entries.flatMap((entry): HistoryItem[] => {
      const config = readStored(entry.json);
      if (config === null || config === "unreadable") return [];
      return [{ id: entry.id, publishedAt: entry.publishedAt, variant: config.variant, headline: config.headline }];
    }),
    publish,
    now: input.now(),
  };
}
