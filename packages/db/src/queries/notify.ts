import { asc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type NotifyAddress, notifyAddresses } from "../schema";

/** Every notify address. A full read on purpose: Cloudflare caps destination addresses at 200. */
export function listNotifyAddresses(db: Db): Promise<NotifyAddress[]> {
  return db.select().from(notifyAddresses).orderBy(asc(notifyAddresses.email));
}

export function getNotifyAddress(db: Db, email: string): Promise<NotifyAddress | undefined> {
  return db.select().from(notifyAddresses).where(eq(notifyAddresses.email, email)).get();
}

/** Adds the address. False, changing nothing, when it already exists. */
export async function insertNotifyAddress(
  db: Db,
  input: { email: string; cfAddressId?: string; verifiedAt?: number; now: number },
): Promise<boolean> {
  const rows = await db
    .insert(notifyAddresses)
    .values({
      email: input.email,
      cfAddressId: input.cfAddressId ?? null,
      verifiedAt: input.verifiedAt ?? null,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ email: notifyAddresses.email });
  return rows.length === 1;
}

export type NotifyAddressPatch = Partial<Pick<NotifyAddress, "cfAddressId" | "verifiedAt" | "lastResentAt">>;

export async function updateNotifyAddress(
  db: Db,
  input: { email: string; patch: NotifyAddressPatch },
): Promise<NotifyAddress | undefined> {
  const rows = await db
    .update(notifyAddresses)
    .set(input.patch)
    .where(eq(notifyAddresses.email, input.email))
    .returning();
  return rows[0];
}

/** Removes the address. Domains that used it fall back to no notify address (their offers are still logged). */
export async function deleteNotifyAddress(db: Db, email: string): Promise<boolean> {
  const rows = await db
    .delete(notifyAddresses)
    .where(eq(notifyAddresses.email, email))
    .returning({ email: notifyAddresses.email });
  return rows.length === 1;
}
