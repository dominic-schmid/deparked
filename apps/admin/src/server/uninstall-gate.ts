// No imports on purpose: the Danger zone runs this in the browser too, and the server checks it again.

/** What exists before Uninstall, and when the offers were last downloaded whole. */
export type UninstallFacts = {
  offers: number;
  domains: number;
  newestOfferAt: number | null;
  exportedAt: number | null;
};

/**
 * Whether Uninstall may start: there are no offers, the owner started a download of every offer after the newest
 * one arrived, or said they need no copy. `reason` is written for the owner.
 */
export function uninstallCopyGate(
  facts: UninstallFacts,
  waived: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (facts.offers === 0 || waived) return { ok: true };
  if (facts.exportedAt !== null && facts.exportedAt >= (facts.newestOfferAt ?? 0)) return { ok: true };
  if (facts.exportedAt !== null) {
    return {
      ok: false,
      reason: "An offer arrived after your last download. Download the offers again, or tick that you need no copy.",
    };
  }
  return { ok: false, reason: "Download your offers first, or tick that you need no copy." };
}
