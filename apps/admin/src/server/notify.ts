import {
  assignMissingNotifyEmail,
  type Db,
  deleteNotifyAddress,
  getDomain,
  getNotifyAddress,
  hitRateLimit,
  insertNotifyAddress,
  listDomains,
  listNotifyAddresses,
  type NotifyAddress,
  refundRateLimit,
  updateDomain,
  updateNotifyAddress,
} from "@deparked/db";
import {
  type NotifyAddress as HostAddress,
  type HostingAdapter,
  HostingError,
  type HostingErrorCode,
} from "@deparked/hosting";
import { z } from "zod";
import { defaultNotifyAddress } from "./notify-default";

export const notifyEmailSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) });

/** `message` is written for the owner, in plain words; nothing here holds a secret. */
export type NotifyResult =
  | { ok: true; message: string }
  | {
      ok: false;
      message: string;
      /** The owner fixes it by replacing the token. */
      credentialsRejected?: true;
      /** What the host said, for the owner who wants the details. */
      detail?: string;
    };

const HOST_TROUBLE: Partial<Record<HostingErrorCode, string>> = {
  unavailable: "Cloudflare did not answer just now, so nothing was changed. Try again in a minute.",
  "rate-limited": "Cloudflare asked Deparked to slow down, so nothing was changed. Wait a minute, then try again.",
};

const RESEND_WAIT_MS = 60_000;
// Verification mails per address, counted across add, resend and remove-then-add: the address may be a
// stranger's, and the account must not be usable to flood it. Below the 24 hours after which counters are pruned.
const MAILS_PER_WINDOW = 5;
const MAIL_WINDOW_MS = 6 * 3_600_000;
// And across all addresses, so one session cannot make Cloudflare mail many strangers.
const ALL_MAILS_PER_WINDOW = 20;
const ALL_MAIL_WINDOW_MS = 3_600_000;

/** "in about 3 hours", "in about 40 minutes", "in a minute": when a window that started at `start` ends. */
export function waitWords(start: number, windowMs: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((start + windowMs - now) / 60_000));
  if (minutes === 1) return "in a minute";
  if (minutes < 90) return `in about ${minutes} minutes`;
  return `in about ${Math.round(minutes / 60)} hours`;
}

function tooMany(start: number, now: number): NotifyResult {
  return {
    ok: false,
    message: `Too many verification emails went to this address: Deparked sends at most ${MAILS_PER_WINDOW} to one address in ${MAIL_WINDOW_MS / 3_600_000} hours, so it cannot be used to flood someone's inbox. You can send the next one ${waitWords(start, MAIL_WINDOW_MS, now)}.`,
  };
}

function tooManyAll(start: number, now: number): NotifyResult {
  return {
    ok: false,
    message: `Too many verification emails went out: Deparked sends at most ${ALL_MAILS_PER_WINDOW} an hour across all addresses. You can send the next one ${waitWords(start, ALL_MAIL_WINDOW_MS, now)}.`,
  };
}

const REMOVED: NotifyResult = { ok: false, message: "That address is not on the list any more." };

type Reservation = { allowed: true; giveBack: () => Promise<void> } | { allowed: false; result: NotifyResult };

/**
 * Reserves one verification mail before the host call, so parallel requests cannot all pass. The reservation is
 * given back when the call fails or is refused: only a mail that went out counts.
 */
async function reserveMail(db: Db, email: string, now: number): Promise<Reservation> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.toLowerCase()));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const each = { key: `notify:${hash}`, windowMs: MAIL_WINDOW_MS, now };
  const all = { key: "notify:all", windowMs: ALL_MAIL_WINDOW_MS, now };
  const [eachHit, allHit] = [await hitRateLimit(db, each), await hitRateLimit(db, all)];
  const giveBack = async () => {
    await refundRateLimit(db, { key: each.key, windowStart: eachHit.windowStart });
    await refundRateLimit(db, { key: all.key, windowStart: allHit.windowStart });
  };
  if (allHit.count <= ALL_MAILS_PER_WINDOW && eachHit.count <= MAILS_PER_WINDOW) return { allowed: true, giveBack };
  await giveBack();
  return {
    allowed: false,
    result:
      allHit.count > ALL_MAILS_PER_WINDOW ? tooManyAll(allHit.windowStart, now) : tooMany(eachHit.windowStart, now),
  };
}

export function failed(error: unknown): NotifyResult {
  if (!(error instanceof HostingError)) throw error;
  if (error.credentialsRejected) return { ok: false, message: error.message, credentialsRejected: true };
  const message = HOST_TROUBLE[error.code] ?? "Cloudflare did not accept the request, so nothing was changed.";
  return { ok: false, message, detail: error.message };
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

/**
 * Gives every domain without a notify address the default one (`defaultNotifyAddress`), so offers never silently
 * go nowhere. Run whenever an address or a domain appears, or an address is verified. Returns the hosts it changed.
 */
export async function fillMissingNotifyAddresses(db: Db, now: number): Promise<string[]> {
  const address = defaultNotifyAddress(await listNotifyAddresses(db));
  return address === null ? [] : assignMissingNotifyEmail(db, { email: address.email, now });
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
  const mail = await reserveMail(db, input.email, input.now);
  if (!mail.allowed) return mail.result;
  try {
    const address = await hosting.notifyAddresses.add(input.email);
    const verifiedAt = verifiedAtOf(address, input.now);
    const inserted = await insertNotifyAddress(db, {
      email: input.email,
      cfAddressId: address.id,
      ...(verifiedAt === null ? {} : { verifiedAt }),
      now: input.now,
    });
    // A second request added it in the meantime: that one's row stands.
    if (!inserted) return { ok: true, message: `${input.email} is already on the list.` };
    if (verifiedAt === null) await updateNotifyAddress(db, { email: input.email, patch: { lastResentAt: input.now } });
    await fillMissingNotifyAddresses(db, input.now);
    return {
      ok: true,
      message:
        verifiedAt === null
          ? `Verification email sent to ${input.email}. Click the link in it, then check again here.`
          : `${input.email} was verified before and is ready to use.`,
    };
  } catch (error) {
    await mail.giveBack();
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
  if (row === undefined) return REMOVED;
  if (row.verifiedAt !== null) return { ok: true, message: `${row.email} is already verified.` };
  if (row.lastResentAt !== null && input.now - row.lastResentAt < RESEND_WAIT_MS) {
    return {
      ok: false,
      message: `A verification email went to ${row.email} less than a minute ago, and it can take a minute to arrive. You can send another ${waitWords(row.lastResentAt, RESEND_WAIT_MS, input.now)}.`,
    };
  }
  const mail = await reserveMail(db, row.email, input.now);
  if (!mail.allowed) return mail.result;
  try {
    const address = await resendOrAdd(hosting, row);
    const verifiedAt = verifiedAtOf(address, input.now);
    const updated = await updateNotifyAddress(db, {
      email: row.email,
      patch: { cfAddressId: address.id, verifiedAt, lastResentAt: input.now },
    });
    // Removed by another request while the mail went out.
    if (updated === undefined) return REMOVED;
    if (verifiedAt !== null) await fillMissingNotifyAddresses(db, input.now);
    return {
      ok: true,
      message: verifiedAt === null ? `Verification email sent again to ${row.email}.` : `${row.email} is verified.`,
    };
  } catch (error) {
    await mail.giveBack();
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
 * Takes the address off the list. A verified address is refused while a domain sends its offers there; a pending
 * one never got any, so its domains move to the next default address (or to none). At the host only a pending
 * address is deleted: a verified one may serve the owner's own mail rules, which Deparked did not create.
 */
export async function removeNotifyAddress(
  db: Db,
  hosting: HostingAdapter,
  input: { email: string; now: number },
): Promise<NotifyResult> {
  const row = await getNotifyAddress(db, input.email);
  if (row === undefined) return { ok: true, message: "That address was removed already." };
  const users = (await listDomains(db)).filter((domain) => domain.notifyEmail === row.email);
  const first = users[0];
  if (first !== undefined && row.verifiedAt !== null) {
    return {
      ok: false,
      message: `${hostList(users.map((domain) => domain.host))} still ${users.length === 1 ? "sends" : "send"} offers to ${row.email}. Pick another address there first.`,
    };
  }
  try {
    const remote = (await hosting.notifyAddresses.list()).find((address) => sameEmail(address.email, row.email));
    if (remote !== undefined && !remote.verified) await hosting.notifyAddresses.remove(remote.id);
    for (const domain of users)
      await updateDomain(db, { host: domain.host, patch: { notifyEmail: null }, now: input.now });
    await deleteNotifyAddress(db, row.email);
    const removed = remote?.verified
      ? `${row.email} was removed here. It stays a verified address in your Cloudflare account.`
      : `${row.email} was removed.`;
    if (first === undefined) return { ok: true, message: removed };
    await fillMissingNotifyAddresses(db, input.now);
    const next = (await getDomain(db, first.host))?.notifyEmail ?? null;
    const names = hostList(users.map((domain) => domain.host));
    return {
      ok: true,
      message:
        next === null
          ? `${removed} ${names} ${users.length === 1 ? "has" : "have"} no address for offers now: they wait in the inbox.`
          : `${removed} Offers for ${names} go to ${next} now.`,
    };
  } catch (error) {
    return failed(error);
  }
}

function hostList(hosts: string[]): string {
  const [first, ...rest] = hosts;
  return rest.length === 0 ? (first ?? "") : `${first} and ${rest.length} more`;
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
    await fillMissingNotifyAddresses(db, input.now);
    return { ok: true, message: verified === 1 ? "1 address is verified." : `${verified} addresses are verified.` };
  } catch (error) {
    return failed(error);
  }
}

/** Where a domain's offers are emailed. Only a verified address: Cloudflare delivers to no other. */
export async function pickNotifyAddress(
  db: Db,
  input: { host: string; email: string; now: number },
): Promise<NotifyResult> {
  const address = await getNotifyAddress(db, input.email);
  if (address === undefined) return { ok: false, message: `${input.email} is not on your list of addresses.` };
  if (address.verifiedAt === null) {
    return { ok: false, message: `${address.email} is not verified yet: open the link in Cloudflare's email first.` };
  }
  if ((await getDomain(db, input.host)) === undefined)
    return { ok: false, message: `${input.host} is not managed here.` };
  await updateDomain(db, { host: input.host, patch: { notifyEmail: address.email }, now: input.now });
  return { ok: true, message: `Offers for ${input.host} go to ${address.email}.` };
}
