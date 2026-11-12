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

/** Belt and braces next to the iframe's empty `sandbox`: the preview runs no script and posts no form. */
const PREVIEW_CSP = "script-src 'none'; form-action 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'";

export type PreviewResult = { ok: true; html: string } | { ok: false; errors: ConfigErrors };

/**
 * The lander for an unsaved draft, exactly as `render` publishes it, made inert for an iframe. `assetBase` is the
 * origin that serves `/catalog/*`: null when the admin is opened on a managed domain, which serves it itself.
 * Never writes anything.
 */
export function renderPreview(
  input: { catalog: Catalog },
  host: string,
  config: unknown,
  assetBase: string | null,
): PreviewResult {
  const parsed = parseConfig(config);
  if (!parsed.ok) return parsed;
  const html = render(parsed.config, host, { catalog: input.catalog, sitekey: PREVIEW_SITEKEY })["index.html"];
  const base = assetBase === null ? "" : `<base href="${escapeAttribute(assetBase)}">`;
  const head = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">${base}`;
  return { ok: true, html: html.replace("<head>", `<head>${head}`).replace("</head>", `${PREVIEW_STYLE}</head>`) };
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export type VariantOption = { id: Variant; available: boolean; color: string; contrast: string };
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
export function variantOptions(): VariantOption[] {
  const fallback = variants.sky;
  return VARIANTS.map((id) => {
    const definition = variants[id];
    return {
      id,
      available: definition !== undefined,
      color: (definition ?? fallback).color,
      contrast: (definition ?? fallback).contrast,
    };
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
    variants: variantOptions(),
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
