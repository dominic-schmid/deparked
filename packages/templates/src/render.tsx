import { type Config, fillDomain } from "@deparked/config";
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Catalog, CatalogFont } from "./catalog";
import { OFFER_ENDPOINT } from "./offer";
import { faviconHref, jsonForScript, robotsTxt, sitemapXml, siteOrigin } from "./site";
import { resolveVariant } from "./variants";

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
  const background = catalog.backgrounds.find((candidate) => candidate.id === config.background);
  const island = catalog.islands[id];
  const fonts = variant.fonts.flatMap(({ id, preload }) => {
    const font = catalog.fonts.find((candidate) => candidate.id === id);
    return font ? [{ font, preload }] : [];
  });

  const origin = siteOrigin(host);
  const title = fillDomain(config.seo.title, host);
  const description = fillDomain(config.seo.description, host);
  const color = config.accent?.primary ?? variant.color;
  const contrast = config.accent?.contrast ?? variant.contrast;
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
    <html lang="en" style={accentStyle(config)}>
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
        {variant.colorScheme && <meta name="color-scheme" content={variant.colorScheme} />}
        <link rel="icon" href={faviconHref(host, color, contrast)} />
        {fonts.flatMap(({ font, preload }) => {
          const latin = font.files.find((file) => file.subset === "latin");
          return preload && latin
            ? [<link key={font.id} rel="preload" as="font" type="font/woff2" href={latin.path} crossOrigin="" />]
            : [];
        })}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: build output and catalog data, never owner input */}
        <style dangerouslySetInnerHTML={{ __html: fontFaces(fonts.map(({ font }) => font)) + variant.css }} />
        <script src={TURNSTILE_SCRIPT} async defer />
        {island && <script type="module" src={island.path} />}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON with every markup character escaped */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(jsonLd) }} />
      </head>
      <body>
        <variant.Page
          config={config}
          host={host}
          background={background}
          sitekey={sitekey}
          offerEndpoint={offerEndpoint}
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

/** An accent override reaches the variant's CSS as custom properties; the schema has already limited it to hex. */
function accentStyle({ accent }: Config): CSSProperties | undefined {
  if (!accent?.primary && !accent?.contrast) return undefined;
  return {
    ...(accent.primary ? { "--accent": accent.primary } : {}),
    ...(accent.contrast ? { "--accent-contrast": accent.contrast } : {}),
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
