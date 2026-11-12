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
      <div className="photo" aria-hidden="true">
        {background && <Photo background={background} />}
      </div>
      <main className="panel" data-tone={tone}>
        <header className="bar" data-enter="">
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
            turnstileTheme: tone,
          }}
        />
      </main>
    </>
  );
}

function Photo({ background }: { background: CatalogBackground }) {
  const { avif, webp } = background.formats;
  const srcSet = (images: typeof avif) => images.map((image) => `${image.path} ${image.width}w`).join(", ");
  const largest = webp.at(-1);
  if (!largest) return null;
  return (
    <picture>
      <source type="image/avif" srcSet={srcSet(avif)} sizes={photoSizes(background)} />
      <img
        src={largest.path}
        srcSet={srcSet(webp)}
        sizes={photoSizes(background)}
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

/**
 * The photo covers its pane: upright screens show it as a band across the top (PHOTO_BAND of the height),
 * wide ones as the left half at full height. Must match the layout in styles.css.
 */
export function photoSizes({ width, height }: CatalogBackground): string {
  const ratio = width / height;
  const band = Math.round(PHOTO_BAND * ratio);
  const half = Math.round(ratio * 200) / 100;
  return [
    `(orientation: portrait) and (max-aspect-ratio: ${band}/100) ${band}vh`,
    "(orientation: portrait) 100vw",
    `(max-aspect-ratio: ${Math.round(half * 100)}/100) ${Math.round(ratio * 100)}vh`,
    "50vw",
  ].join(", ");
}

const PHOTO_BAND = 0.36;
