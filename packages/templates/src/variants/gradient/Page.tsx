import { fillDomain, sentenceParts } from "@deparked/config";
import type { CSSProperties } from "react";
import { Island } from "../../island";
import { OfferForm } from "../shared/offer-form/OfferForm";
import type { PageProps } from "../types";
import { fitMark } from "./mark";

/** Characters of offer sentence past which it is set smaller. The default sentence is 91. */
const LONG_SENTENCE = 120;

export function Page({ config, host, gradient, sitekey, offerEndpoint }: PageProps) {
  const headline = fillDomain(config.headline, host);
  const fit = fitMark(headline);
  const tone = gradient?.tone ?? "dark";
  return (
    <div className="page" data-tone={tone}>
      <div
        className="field"
        aria-hidden="true"
        style={gradient ? { backgroundColor: gradient.color, backgroundImage: gradient.css } : undefined}
      />
      <header className="top" data-enter="">
        <span>For sale</span>
        <span>Offers by email</span>
      </header>
      <h1
        className="mark"
        dir="auto"
        translate="no"
        data-enter=""
        data-lines={fit.lines?.length === 1 ? undefined : (fit.lines?.length ?? "auto")}
        style={{ "--i": 2, "--fit": `${fit.fontSizeCqi}cqi`, "--lines": fit.lines?.length ?? 2 } as CSSProperties}
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
        data-long={config.sentence.length > LONG_SENTENCE ? "" : undefined}
        data-enter=""
        style={{ "--i": 1 } as CSSProperties}
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
    </div>
  );
}
