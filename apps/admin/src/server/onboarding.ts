import { type Db, listDomains, listNotifyAddresses, type NotifyAddress } from "@deparked/db";

/**
 * The first-run wizard after the password, derived from what exists, so a reload resumes it and nothing marks it
 * done. `notify`: no address yet. `inbox`: an address exists, the owner has not moved on. `domain`: the owner moved
 * on, no domain yet. `done`: a domain exists (even a removed one), and the wizard is never shown again.
 */
export type OnboardingScreen = "notify" | "inbox" | "domain" | "done";

export function onboardingScreen(input: {
  addressCount: number;
  domainCount: number;
  /** The owner pressed Continue on the inbox screen (`?step=domain`). */
  wantsDomainStep: boolean;
}): OnboardingScreen {
  if (input.domainCount > 0) return "done";
  if (input.addressCount === 0) return "notify";
  return input.wantsDomainStep ? "domain" : "inbox";
}

/** Where a fresh password lands: the wizard while the workspace is empty, else the overview. */
export function afterSetupPath(input: { addressCount: number; domainCount: number }): string {
  return input.addressCount === 0 && input.domainCount === 0 ? "/admin/welcome" : "/admin";
}

export async function loadOnboarding(db: Db): Promise<{ addresses: NotifyAddress[]; domainCount: number }> {
  const [addresses, domains] = await Promise.all([listNotifyAddresses(db), listDomains(db, { includeRemoved: true })]);
  return { addresses, domainCount: domains.length };
}
