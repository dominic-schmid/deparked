import { fillDomain, sentenceParts } from "@deparked/config";
import type { CSSProperties } from "react";
import type { CatalogBackground } from "../../catalog";
import { Island } from "../../island";
import { OfferForm } from "../shared/offer-form/OfferForm";
import type { PageProps } from "../types";
import { fitMark } from "./mark";

export function Page({ config, host, background, sitekey, offerEndpoint, tone }: PageProps) {
  const headline = fillDomain(config.headline, host);
  const fit = fitMark(headline);
  return (
    <>
      {background && <Background background={background} />}
      <header
        className="flex justify-between gap-4 text-[13px] font-semibold tracking-[0.08em] uppercase"
        data-enter=""
      >
        <span>For sale</span>
        <span>Offers by email</span>
      </header>
      <h1
        className="mark"
        dir="auto"
        translate="no"
        data-enter=""
        data-lines={fit.lines?.length === 1 ? undefined : (fit.lines?.length ?? "auto")}
        style={{ "--i": 1, "--fit": `${fit.fontSizeCqi}cqi`, "--lines": fit.lines?.length ?? 2 } as CSSProperties}
      >
        {fit.lines && fit.lines.length > 1
          ? fit.lines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one headline, in order
              <span key={index}>{line}</span>
            ))
          : headline}
      </h1>
      <Island
        name="offer-form"
        component={OfferForm}
        className="offer"
        data-flat={background ? undefined : tone}
        data-enter=""
        style={{ "--i": 2 } as CSSProperties}
        props={{
          endpoint: offerEndpoint,
          sitekey,
          currency: config.currency,
          minOffer: config.minOffer,
          sentence: sentenceParts(config.sentence, host),
          finePrint: fillDomain(config.escrowLine, host),
          ...(config.marketplaceUrl ? { marketplaceUrl: config.marketplaceUrl } : {}),
          turnstileTheme: background ? "dark" : tone,
        }}
      />
    </>
  );
}

function Background({ background }: { background: CatalogBackground }) {
  const { avif, webp } = background.formats;
  const srcSet = (images: typeof avif) => images.map((image) => `${image.path} ${image.width}w`).join(", ");
  const largest = webp.at(-1);
  if (!largest) return null;
  return (
    <picture className="bg">
      <source type="image/avif" srcSet={srcSet(avif)} sizes={coverSizes(background)} />
      <img
        src={largest.path}
        srcSet={srcSet(webp)}
        sizes={coverSizes(background)}
        width={background.width}
        height={background.height}
        alt=""
        fetchPriority="high"
        decoding="async"
        style={{
          objectPosition: background.position,
          backgroundImage: `url(${background.placeholder})`,
          backgroundPosition: background.position,
        }}
      />
    </picture>
  );
}

/** The image covers the viewport: as wide as the viewport, or wider when the viewport is taller than the image. */
export function coverSizes({ width, height }: CatalogBackground): string {
  return `(max-aspect-ratio: ${width}/${height}) ${Math.round((width / height) * 100)}vh, 100vw`;
}
