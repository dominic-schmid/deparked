import { type Db, initWorkspace, insertDomain, insertNotifyAddress } from "@deparked/db";

export const NOW = 1_800_000_000_000;
export const HOST = "example.com";
export const NOTIFY = "owner@example.com";

/** A workspace, one verified notify address and one domain that uses it. */
export async function seed(db: Db): Promise<void> {
  await initWorkspace(db, { now: NOW });
  await insertNotifyAddress(db, { email: NOTIFY, verifiedAt: NOW, now: NOW });
  await insertDomain(db, { domain: { host: HOST, zoneId: "zone-1", notifyEmail: NOTIFY }, now: NOW });
}
