import { CONFIG_VERSION, type Config } from "./schema";

/** A new domain's config: today's wrappr.app, with the domain name as a placeholder so it fits any host. */
export function defaultConfig(): Config {
  return {
    version: CONFIG_VERSION,
    variant: "sky",
    background: "sky",
    headline: "{domain}",
    sentence: "I'd like to buy {domain} for {amount}. My name is {name} and you can reach me at {email}.",
    currency: "EUR",
    minOffer: 1000,
    escrowLine: "The owner reads every offer and replies by email. Payment through Escrow.com.",
    seo: {
      title: "{domain} is for sale",
      description: "The domain {domain} is for sale. Send the owner an offer.",
    },
  };
}
