/** `https://<host>` with anything that is not a hostname character percent-encoded, so a host can never add markup or lines. */
export const siteOrigin = (host: string): string =>
  `https://${host.toLowerCase().replace(/[^a-z0-9.-]/g, (character) => encodeURIComponent(character))}`;

const escapeXml = (text: string): string => text.replace(/[<>&'"]/g, (character) => `&#${character.charCodeAt(0)};`);

export function robotsTxt(host: string, indexable: boolean): string {
  if (!indexable) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${siteOrigin(host)}/sitemap.xml\n`;
}

/** No `lastmod`: the same input must always give the same bytes. */
export function sitemapXml(host: string, indexable: boolean): string {
  const urls = indexable ? `\n  <url><loc>${escapeXml(siteOrigin(host))}/</loc></url>\n` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`;
}

/** A letter on a rounded square, as a data URI: no extra request, and it follows the variant's colour. */
export function faviconHref(host: string, color: string, contrast: string): string {
  const letter = escapeXml([...host][0] ?? "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/><text x="16" y="23" font-family="Arial" font-weight="900" font-size="20" text-anchor="middle" fill="${contrast}">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** JSON for a `<script type="application/ld+json">`: no `<` can end the element early. */
// U+2028 and U+2029 end a line in older script parsers.
const SCRIPT_UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, "g");
export const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replace(
    SCRIPT_UNSAFE,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
