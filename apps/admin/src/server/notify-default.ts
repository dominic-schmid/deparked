// No imports on purpose: the wizard and the add-domain screen use this in the browser too.

type Address = { email: string; verifiedAt: number | null; createdAt: number };

/**
 * The address a domain without one gets: the only address, else the most recently verified one. Null when there
 * is none yet, or several and none verified: then the first one to be verified is taken. A pending address may be
 * given: offers are only ever emailed to it once it is verified (`sendEmail` checks on every offer).
 */
export function defaultNotifyAddress(addresses: readonly Address[]): Address | null {
  if (addresses.length === 1) return addresses[0] ?? null;
  let best: Address | null = null;
  for (const address of addresses) {
    if (address.verifiedAt !== null && (best === null || address.verifiedAt > (best.verifiedAt ?? 0))) best = address;
  }
  return best;
}

/** Whether offers for a domain are emailed, and if not, why. */
export type OfferMail =
  | { state: "ok"; email: string }
  /** No address in the workspace at all. */
  | { state: "no-address" }
  /** The domain's address has not been verified yet. */
  | { state: "unverified"; email: string }
  /** Addresses exist, but none is the domain's. */
  | { state: "unassigned" };

export function offerMail(notifyEmail: string | null, addresses: readonly Address[]): OfferMail {
  if (notifyEmail === null) return addresses.length === 0 ? { state: "no-address" } : { state: "unassigned" };
  const address = addresses.find((candidate) => candidate.email === notifyEmail);
  if (address === undefined || address.verifiedAt === null) return { state: "unverified", email: notifyEmail };
  return { state: "ok", email: notifyEmail };
}
