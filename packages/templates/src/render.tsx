import { type Config, fillDomain } from "@deparked/config";
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Catalog, CatalogFont } from "./catalog";
import { contrastOn, luminance, readableOn } from "./contrast";
import { OFFER_ENDPOINT } from "./offer";
import { faviconHref, jsonForScript, robotsTxt, sitemapXml, siteOrigin } from "./site";
import { resolveVariant } from "./variants";
import type { VariantDefinition } from "./variants/types";

/** The files of one domain, by their path under `/sites/<host>/`. */
export type SiteFiles = { "index.html": string; "robots.txt": string; "sitemap.xml": string };

/** What a page needs that is not the owner's config. */
export type RenderOptions = {
  /** The release's `/catalog/catalog.json`: resolves the background, the fonts and the variant's island bundle. */
  catalog: Catalog;
  /** The Turnstile sitekey of the widget this host belongs to. */
  sitekey: string;
  /** Cloudflare Web Analytics token; the beacon is left out without one. */
  beaconToken?: string;
  /** Where the offer form posts. Defaults to `/api/offer`. */
  offerEndpoint?: string;
};

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const BEACON_SCRIPT = "https://static.cloudflareinsights.com/beacon.min.js";

/**
 * Renders a domain's published files from its config. Pure: no clock, no randomness, no I/O, no Node APIs.
 * The same call gives the same bytes in Node, workerd and the browser, so the admin's preview is the published page.
 */
export function render(config: Config, host: string, options: RenderOptions): SiteFiles {
  const { catalog, sitekey, beaconToken, offerEndpoint = OFFER_ENDPOINT } = options;
  const { id, definition: variant } = resolveVariant(config.variant);
  // A variant without a photo ignores a photo background, also for the share image.
  const background = variant.backgroundSizes
    ? catalog.backgrounds.find((candidate) => candidate.id === config.background)
    : undefined;
  const gradient = variant.gradient
    ? (catalog.gradients.find((candidate) => candidate.id === config.background) ??
      catalog.gradients.find((candidate) => candidate.id === variant.gradient))
    : undefined;
  const island = catalog.islands[id];
  const fonts = variant.fonts.flatMap(({ id, preload }) => {
    const font = catalog.fonts.find((candidate) => candidate.id === id);
    return font ? [{ font, preload }] : [];
  });

  const origin = siteOrigin(host);
  const title = fillDomain(config.seo.title, host);
  const description = fillDomain(config.seo.description, host);
  const accent = hexColor(config.accent?.primary, "accent.primary");
  const accentContrast =
    hexColor(config.accent?.contrast, "accent.contrast") ?? (accent && contrastOn(accent, variant.onAccent));
  const color = accent ?? gradient?.color ?? variant.color;
  // a light gradient carries ink, not the variant's white, in the favicon too
  const contrast = accentContrast ?? (gradient?.tone === "light" ? "#1c2116" : variant.contrast);
  const tone = luminance(accentContrast ?? contrastOn(color, variant.onAccent)) < 0.5 ? "light" : "dark";
  // a variant that commits to one scheme commits to its flat colour's, so a pale accent gets light controls
  const scheme =
    variant.colorScheme === "light dark" ? variant.colorScheme : variant.colorScheme ? tone : gradient?.tone;
  const shareImage = background?.formats.webp.find((image) => image.width >= 1200) ?? background?.formats.webp.at(-1);
  // WebPage, not Product/Offer: an Offer needs a real price, and the minimum is a quiet filter, not an asking price.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: `${origin}/`,
    name: title,
    description,
    inLanguage: "en",
    about: { "@type": "Thing", name: host, description: `The domain name ${host}, for sale by its owner.` },
  };

  const html = renderToStaticMarkup(
    <html lang="en" style={accentStyle(accent, accentContrast, variant.accentMarksOn)}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={`${origin}/`} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`${origin}/`} />
        <meta property="og:site_name" content={host} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        {shareImage && <meta property="og:image" content={`${origin}${shareImage.path}`} />}
        <meta name="twitter:card" content={shareImage ? "summary_large_image" : "summary"} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {shareImage && <meta name="twitter:image" content={`${origin}${shareImage.path}`} />}
        <meta name="theme-color" content={color} />
        {variant.darkColor && !config.accent?.primary && (
          <meta name="theme-color" media="(prefers-color-scheme: dark)" content={variant.darkColor} />
        )}
        {scheme && <meta name="color-scheme" content={scheme} />}
        <link rel="icon" href={faviconHref(host, color, contrast)} />
        {background && variant.backgroundSizes && (
          <link
            rel="preload"
            as="image"
            type="image/avif"
            imageSrcSet={background.formats.avif.map((image) => `${image.path} ${image.width}w`).join(", ")}
            imageSizes={variant.backgroundSizes(background)}
            fetchPriority="high"
          />
        )}
        {fonts.flatMap(({ font, preload }) => {
          const latin = font.files.find((file) => file.subset === "latin");
          return preload && latin
            ? [<link key={font.id} rel="preload" as="font" type="font/woff2" href={latin.path} crossOrigin="" />]
            : [];
        })}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: build output and catalog data, never owner input */}
        <style dangerouslySetInnerHTML={{ __html: fontFaces(fonts.map(({ font }) => font)) + variant.css }} />
        <script src={TURNSTILE_SCRIPT} async defer />
        {/* the page reads and posts without it: it must not compete with the photo and the fonts */}
        {island && <script type="module" src={island.path} fetchPriority="low" />}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON with every markup character escaped */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(jsonLd) }} />
      </head>
      <body>
        <variant.Page
          config={config}
          host={host}
          background={background}
          gradient={gradient}
          sitekey={sitekey}
          offerEndpoint={offerEndpoint}
          tone={tone}
        />
        {beaconToken && <script defer src={BEACON_SCRIPT} data-cf-beacon={JSON.stringify({ token: beaconToken })} />}
      </body>
    </html>,
  );

  return {
    "index.html": `<!doctype html>${html}`,
    "robots.txt": robotsTxt(host, true),
    "sitemap.xml": sitemapXml(host, true),
  };
}

/**
 * An accent colour goes into a style attribute and the favicon's SVG. `parseConfig` already limits it to hex;
 * a config built without it must not be able to put anything else there.
 */
function hexColor(value: string | undefined, field: string): string | undefined {
  if (value !== undefined && !/^#[0-9a-f]{6}$/.test(value)) {
    throw new Error(`${field} must be a six-digit lowercase hex colour like #7f9fbf, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * An accent override reaches the variant's CSS as custom properties: the colour, the text colour on it, and the
 * colour shaded until it reads as a mark on the page's own background(s).
 */
function accentStyle(
  accent: string | undefined,
  contrast: string | undefined,
  marksOn: VariantDefinition["accentMarksOn"],
): CSSProperties | undefined {
  if (!accent && !contrast) return undefined;
  return {
    ...(accent ? { "--accent": accent } : {}),
    ...(contrast ? { "--accent-contrast": contrast } : {}),
    ...(accent && marksOn ? { "--accent-mark": readableOn(accent, marksOn.light) } : {}),
    ...(accent && marksOn?.dark ? { "--accent-mark-dark": readableOn(accent, marksOn.dark) } : {}),
  } as CSSProperties;
}

function fontFaces(fonts: CatalogFont[]): string {
  return fonts
    .flatMap((font) =>
      font.files.map(
        (file) =>
          `@font-face{font-family:${font.family};font-style:${font.style};font-weight:${font.weight};${
            font.stretch ? `font-stretch:${font.stretch};` : ""
          }font-display:swap;src:url(${file.path}) format("woff2");unicode-range:${file.unicodeRange}}`,
      ),
    )
    .join("");
}
