import {
  type Db,
  deleteNotifyAddress,
  getNotifyAddress,
  insertNotifyAddress,
  listDomains,
  listNotifyAddresses,
  type NotifyAddress,
  updateNotifyAddress,
} from "@deparked/db";
import { type NotifyAddress as HostAddress, type HostingAdapter, HostingError } from "@deparked/hosting";
import { z } from "zod";

export const notifyEmailSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) });

/** `message` is written for the owner. Hosting errors already are; nothing here holds a secret. */
export type NotifyResult = { ok: true; message: string } | { ok: false; message: string };

const RESEND_WAIT_MS = 60_000;

function failed(error: unknown): NotifyResult {
  if (error instanceof HostingError) return { ok: false, message: error.message };
  throw error;
}

function verifiedAtOf(address: HostAddress, now: number): number | null {
  if (!address.verified) return null;
  const parsed = address.verifiedAt === null ? Number.NaN : Date.parse(address.verifiedAt);
  return Number.isNaN(parsed) ? now : parsed;
}

function sameEmail(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function loadNotifyAddresses(db: Db): Promise<NotifyAddress[]> {
  return listNotifyAddresses(db);
}

/** Has the host send its verification mail, then lists the address as pending. Adding it twice changes nothing. */
export async function addNotifyAddress(
  db: Db,
  hosting: HostingAdapter,
  input: { email: string; now: number },
): Promise<NotifyResult> {
  if ((await getNotifyAddress(db, input.email)) !== undefined) {
    return { ok: true, message: `${input.email} is already on the list.` };
  }
  try {
    const address = await hosting.notifyAddresses.add(input.email);
    const verifiedAt = verifiedAtOf(address, input.now);
    await insertNotifyAddress(db, {
      email: input.email,
      cfAddressId: address.id,
      ...(verifiedAt === null ? {} : { verifiedAt }),
      now: input.now,
    });
    return {
      ok: true,
      message:
        verifiedAt === null
          ? `Verification email sent to ${input.email}. Click the link in it, then check again here.`
          : `${input.email} was verified before and is ready to use.`,
    };
  } catch (error) {
    return failed(error);
  }
}

/** Sends the verification mail again, at most once a minute. A verified address is left alone. */
export async function resendNotifyAddress(
  db: Db,
  hosting: HostingAdapter,
  input: { email: string; now: number },
): Promise<NotifyResult> {
  const row = await getNotifyAddress(db, input.email);
  if (row === undefined) return { ok: false, message: "That address is not on the list any more." };
  if (row.verifiedAt !== null) return { ok: true, message: `${row.email} is already verified.` };
  if (row.lastResentAt !== null && input.now - row.lastResentAt < RESEND_WAIT_MS) {
    return { ok: false, message: "A verification email was sent a moment ago. Wait a minute before sending another." };
  }
  try {
    const address = await resendOrAdd(hosting, row);
    const verifiedAt = verifiedAtOf(address, input.now);
    await updateNotifyAddress(db, {
      email: row.email,
      patch: { cfAddressId: address.id, verifiedAt, lastResentAt: input.now },
    });
    return {
      ok: true,
      message: verifiedAt === null ? `Verification email sent again to ${row.email}.` : `${row.email} is verified.`,
    };
  } catch (error) {
    return failed(error);
  }
}

// The host forgets an address whose resend failed halfway (see `NotifyAddresses.resend`): adding it again recovers.
async function resendOrAdd(hosting: HostingAdapter, row: NotifyAddress): Promise<HostAddress> {
  if (row.cfAddressId === null) return hosting.notifyAddresses.add(row.email);
  try {
    return await hosting.notifyAddresses.resend(row.cfAddressId);
  } catch (error) {
    if (error instanceof HostingError && error.code === "not-found") return hosting.notifyAddresses.add(row.email);
    throw error;
  }
}

/**
 * Takes the address off the list. Refused while a domain sends its offers there. At the host only a pending
 * address is deleted: a verified one may serve the owner's own mail rules, which Deparked did not create.
 */
export async function removeNotifyAddress(
  db: Db,
  hosting: HostingAdapter,
  input: { email: string },
): Promise<NotifyResult> {
  const row = await getNotifyAddress(db, input.email);
  if (row === undefined) return { ok: true, message: "That address was removed already." };
  const users = (await listDomains(db)).filter((domain) => domain.notifyEmail === row.email);
  const first = users[0];
  if (first !== undefined) {
    const others = users.length - 1;
    const names = others === 0 ? first.host : `${first.host} and ${others} more`;
    return {
      ok: false,
      message: `${names} still ${users.length === 1 ? "sends" : "send"} offers to ${row.email}. Pick another address there first.`,
    };
  }
  try {
    const remote = (await hosting.notifyAddresses.list()).find((address) => sameEmail(address.email, row.email));
    if (remote !== undefined && !remote.verified) await hosting.notifyAddresses.remove(remote.id);
    await deleteNotifyAddress(db, row.email);
    return {
      ok: true,
      message: remote?.verified
        ? `${row.email} was removed here. It stays a verified address in your Cloudflare account.`
        : `${row.email} was removed.`,
    };
  } catch (error) {
    return failed(error);
  }
}

/** "Check now": copies each address's verification state from the host. An address the host lost becomes pending. */
export async function refreshNotifyAddresses(
  db: Db,
  hosting: HostingAdapter,
  input: { now: number },
): Promise<NotifyResult> {
  try {
    const remote = await hosting.notifyAddresses.list();
    let verified = 0;
    for (const row of await listNotifyAddresses(db)) {
      const match = remote.find((address) => sameEmail(address.email, row.email));
      const verifiedAt = match === undefined ? null : verifiedAtOf(match, input.now);
      const cfAddressId = match?.id ?? null;
      if (verifiedAt !== null) verified++;
      if ((verifiedAt === null) === (row.verifiedAt === null) && cfAddressId === row.cfAddressId) continue;
      await updateNotifyAddress(db, {
        email: row.email,
        patch: { cfAddressId, verifiedAt: verifiedAt === null ? null : (row.verifiedAt ?? verifiedAt) },
      });
    }
    return { ok: true, message: verified === 1 ? "1 address is verified." : `${verified} addresses are verified.` };
  } catch (error) {
    return failed(error);
  }
}
