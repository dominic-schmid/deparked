import { env } from "cloudflare:workers";
import { countNewOffers, createDb, listOffers } from "@deparked/db";
import { createServerFn } from "@tanstack/react-start";
import {
  changeOfferStatus,
  loadOffer,
  loadOffers,
  offerIdSchema,
  offerPageSchema,
  offerStatusChangeSchema,
} from "./offers";
import { requireSession } from "./require-session";

export const getOffers = createServerFn()
  .validator(offerPageSchema)
  .handler(async ({ data }) => {
    await requireSession();
    const db = createDb(env.DB);
    const page = await loadOffers(db, data);
    const { selected } = data;
    // A link to one offer (`?offer=`) shows it even when the list's first page does not hold it.
    const [extra, newCount, anyOffers] = await Promise.all([
      selected === undefined || page.offers.some((offer) => offer.id === selected) ? null : loadOffer(db, selected),
      countNewOffers(db, data.host),
      // An empty filtered page: are there offers at all, or is this the very start?
      page.offers.length > 0
        ? true
        : listOffers(db, { ...(data.host === undefined ? {} : { host: data.host }), limit: 1 }).then(
            (any) => any.offers.length > 0,
          ),
    ]);
    return { ...page, selected: extra, newCount, anyOffers, now: Date.now() };
  });

export const setOfferStatus = createServerFn({ method: "POST" })
  .validator(offerStatusChangeSchema)
  .handler(async ({ data }) => {
    await requireSession();
    return { ok: await changeOfferStatus(createDb(env.DB), { ...data, now: Date.now() }) };
  });

/** One offer, for the page that changes its status without JavaScript. Null when there is none. */
export const getOffer = createServerFn()
  .validator(offerIdSchema)
  .handler(async ({ data }) => {
    await requireSession();
    return loadOffer(createDb(env.DB), data);
  });
