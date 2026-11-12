import { renderToStaticMarkup } from "react-dom/server";
import type { SiteFiles } from "../render";
import { faviconHref, robotsTxt, sitemapXml } from "../site";
import { PlaceholderPage } from "./Page";
import { css } from "./styles.generated";

/** The files a domain serves before its first publish: a page that links to `/admin`, kept out of search engines. */
export function renderPlaceholder(host: string): SiteFiles {
  const html = renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{`${host} is not published yet`}</title>
        <meta name="robots" content="noindex" />
        <meta name="theme-color" content="#7f9fbf" />
        <link rel="icon" href={faviconHref(host, "#7f9fbf", "#ffffff")} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: build output, never owner input */}
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <PlaceholderPage host={host} />
      </body>
    </html>,
  );
  return {
    "index.html": `<!doctype html>${html}`,
    "robots.txt": robotsTxt(host, false),
    "sitemap.xml": sitemapXml(host, false),
  };
}
