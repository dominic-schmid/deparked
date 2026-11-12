import { fillDomain, sentenceParts } from "@deparked/config";
import type { CSSProperties } from "react";
import { Island } from "../../island";
import { formatAmount } from "../../offer";
import { OfferForm } from "../shared/offer-form/OfferForm";
import type { PageProps } from "../types";
import { fitMark } from "./mark";

export function Page({ config, host, sitekey, offerEndpoint }: PageProps) {
  const headline = fillDomain(config.headline, host);
  const fit = fitMark(headline);
  const lines = fit.lines ?? [headline];
  const dot = host.indexOf(".");
  // what a buyer checks first, read off the name itself
  const spec = [
    ["Length", `${host.length} characters`],
    ["Ending", dot > 0 ? host.slice(dot) : "none"],
    ["Offers from", formatAmount(config.minOffer, config.currency)],
    ["Reply", "By email"],
  ];
  return (
    <>
      <header className="bar" data-enter="">
        <span className="live">For sale</span>
        <span>Offers by email</span>
      </header>
      <h1
        className="mark"
        dir="auto"
        translate="no"
        data-lines={fit.lines ? (fit.lines.length > 1 ? fit.lines.length : undefined) : "auto"}
        style={{ "--fit": `${fit.fontSizeCqi}cqi`, "--lines": fit.lines?.length ?? 2 } as CSSProperties}
      >
        {lines.map((line, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one headline, in order
            key={index}
            className="line"
            style={{ "--chars": Math.max(1, line.trimEnd().length), "--at": index } as CSSProperties}
          >
            {line}
            {index === lines.length - 1 && <span className="caret" aria-hidden="true" />}
          </span>
        ))}
      </h1>
      <dl className="spec" data-enter="" style={{ "--i": 2 } as CSSProperties}>
        {spec.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd translate={term === "Ending" ? "no" : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      <Island
        name="offer-form"
        component={OfferForm}
        className="offer"
        data-enter=""
        style={{ "--i": 3 } as CSSProperties}
        props={{
          endpoint: offerEndpoint,
          sitekey,
          currency: config.currency,
          minOffer: config.minOffer,
          sentence: sentenceParts(config.sentence, host),
          finePrint: fillDomain(config.escrowLine, host),
          ...(config.marketplaceUrl ? { marketplaceUrl: config.marketplaceUrl } : {}),
          turnstileTheme: "auto",
        }}
      />
    </>
  );
}
