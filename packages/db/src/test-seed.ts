import type { Db } from "./client";
import * as q from "./queries/index";

export const NOW = 1_800_000_000_000;
export const HOST = "example.com";
export const NOTIFY = "owner@example.com";
// Cloudflare's documented Turnstile test sitekey.
export const SITEKEY = "1x00000000000000000000AA";

/** A workspace, one notify address, one widget and one domain using both. */
export async function seed(db: Db): Promise<void> {
  await q.initWorkspace(db, { now: NOW });
  await q.initInstallState(db);
  await q.insertNotifyAddress(db, { email: NOTIFY, verifiedAt: NOW, now: NOW });
  await q.insertTurnstileWidget(db, {
    sitekey: SITEKEY,
    name: "deparked-1",
    secretName: "TURNSTILE_SECRET_1",
    now: NOW,
  });
  await q.claimTurnstileSlot(db, SITEKEY);
  await q.insertDomain(db, {
    domain: { host: HOST, zoneId: "zone-1", turnstileWidgetId: SITEKEY, notifyEmail: NOTIFY },
    now: NOW,
  });
}
