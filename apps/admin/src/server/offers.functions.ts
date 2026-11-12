import { env } from "cloudflare:workers";
import { createDb } from "@deparked/db";
import { createServerFn } from "@tanstack/react-start";
import { changeOfferStatus, loadOffers, offerPageSchema, offerStatusChangeSchema } from "./offers";
import { requireSession } from "./require-session";

export const getOffers = createServerFn()
  .validator(offerPageSchema)
  .handler(async ({ data }) => {
    await requireSession();
    return { ...(await loadOffers(createDb(env.DB), data)), now: Date.now() };
  });

export const setOfferStatus = createServerFn({ method: "POST" })
  .validator(offerStatusChangeSchema)
  .handler(async ({ data }) => {
    await requireSession();
    return { ok: await changeOfferStatus(createDb(env.DB), { ...data, now: Date.now() }) };
  });
