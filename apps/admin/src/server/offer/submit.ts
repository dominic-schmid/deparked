import { type Config, type Currency, MINOR_UNITS_PER_MAJOR, migrateConfig } from "@deparked/config";
import {
  type Db,
  getNotifyAddress,
  getOfferTarget,
  hitRateLimit,
  insertOffer,
  type OfferTarget,
  pruneRateLimits,
  setOfferEmailStatus,
} from "@deparked/db";
import { type HostingAdapter, HostingError } from "@deparked/hosting";
import { RATE_LIMIT_RETENTION_MS, rateLimitKey } from "../auth/account";
import { type OfferField, type OfferFields, parseOfferFields } from "./fields";
import { offerNotification } from "./mail";

/** Per IP (IPv6: per /64), across all domains. Both windows are shorter than `RATE_LIMIT_RETENTION_MS`. */
export const OFFER_BURST = { max: 5, windowMs: 10 * 60 * 1000 } as const;
export const OFFER_SUSTAINED = { max: 20, windowMs: 12 * 60 * 60 * 1000 } as const;

export type OfferDeps = {
  db: Db;
  hosting: HostingAdapter;
  /** Keys the IP hash of the throttle (the Worker's `SESSION_KEY`). */
  sessionKey: string;
  now: number;
  ip: string;
  /** ISO 3166-1 alpha-2 from `CF-IPCountry`, when Cloudflare knows it. */
  country: string | undefined;
  /** The request's hostname, lowercased, without a port. */
  host: string;
};

/** The request's fields as they arrived, unvalidated. */
export type OfferInput = Record<"amount" | "name" | "email" | "message" | "honeypot" | "token", unknown>;

export type OfferFailure =
  | { ok: false; code: "invalid"; field?: OfferField }
  | { ok: false; code: "min-offer"; field: "amount"; minOffer: number; currency: Currency }
  | { ok: false; code: "rate-limited"; retryAfterMs: number }
  | { ok: false; code: "bot-check" | "not-for-sale" | "unavailable" };

export type OfferResult = { ok: true } | OfferFailure;

/** Logs carry a fixed code and nothing from the request: no name, email, amount, message or IP. */
function logCode(code: string): void {
  console.error(`offer: ${code}`);
}

function liveConfig(target: OfferTarget): Config | null {
  if (target.liveJson === null) return null;
  try {
    const result = migrateConfig(JSON.parse(target.liveJson));
    return result.ok ? result.config : null;
  } catch {
    return null;
  }
}

async function throttle(deps: OfferDeps): Promise<{ retryAfterMs: number } | null> {
  const { db, now } = deps;
  const key = await rateLimitKey("offer", deps.sessionKey, deps.ip);
  const burst = await hitRateLimit(db, { key, windowMs: OFFER_BURST.windowMs, now });
  if (burst.count > OFFER_BURST.max) return { retryAfterMs: burst.windowStart + OFFER_BURST.windowMs - now };
  const sustained = await hitRateLimit(db, { key: `${key}:sustained`, windowMs: OFFER_SUSTAINED.windowMs, now });
  if (sustained.count === 1) await pruneRateLimits(db, now - RATE_LIMIT_RETENTION_MS);
  if (sustained.count > OFFER_SUSTAINED.max) {
    return { retryAfterMs: sustained.windowStart + OFFER_SUSTAINED.windowMs - now };
  }
  return null;
}

type EmailOutcome = { emailStatus: "sent"; notifiedTo: string } | { emailStatus: "failed"; emailError: string };

async function sendEmail(
  deps: OfferDeps,
  target: OfferTarget,
  currency: Currency,
  fields: OfferFields,
): Promise<EmailOutcome> {
  const to = target.notifyEmail;
  if (to === null) return { emailStatus: "failed", emailError: "This domain has no address for offers yet." };
  const address = await getNotifyAddress(deps.db, to);
  if (address === undefined || address.verifiedAt === null) {
    return { emailStatus: "failed", emailError: "The address for offers is not verified yet." };
  }
  try {
    await deps.hosting.sendNotification(
      offerNotification({
        host: target.host,
        senderHost: target.senderHost ?? target.host,
        to,
        currency,
        country: deps.country,
        fields,
      }),
    );
    return { emailStatus: "sent", notifiedTo: to };
  } catch (error) {
    // A HostingError's message is written for the admin UI and quotes no address; anything else stays out.
    logCode(error instanceof HostingError ? `email-${error.code}` : "email-error");
    return {
      emailStatus: "failed",
      emailError: error instanceof HostingError ? error.message : "The email could not be sent.",
    };
  }
}

/**
 * One offer, from the raw fields to the stored row and the owner's email. The offer is stored before the email
 * is tried, and a failed email never fails the offer: the row is flagged for the admin instead.
 */
export async function submitOffer(deps: OfferDeps, input: OfferInput): Promise<OfferResult> {
  const { db, now, host } = deps;
  // A bot that fills the hidden field is told what a person is told, and nothing happens.
  if (input.honeypot !== undefined && input.honeypot !== null && String(input.honeypot).trim() !== "") {
    return { ok: true };
  }

  // `www.` redirects to the bare domain at the zone and is never a managed host itself.
  const target = host.startsWith("www.") ? undefined : await getOfferTarget(db, host);
  if (target === undefined || target.status !== "live" || target.liveJson === null) {
    return { ok: false, code: "not-for-sale" };
  }
  const config = liveConfig(target);
  if (config === null) {
    logCode("live-config-unreadable");
    return { ok: false, code: "unavailable" };
  }

  const parsed = parseOfferFields(input);
  if (!parsed.ok) return parsed.field === undefined ? { ok: false, code: "invalid" } : { ...parsed, code: "invalid" };
  const { fields } = parsed;
  if (fields.amount < config.minOffer) {
    return { ok: false, code: "min-offer", field: "amount", minOffer: config.minOffer, currency: config.currency };
  }
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (token === "") return { ok: false, code: "bot-check" };
  if (target.turnstileSecretName === null) {
    logCode("bot-check-not-configured");
    return { ok: false, code: "unavailable" };
  }

  // From here on a request costs a siteverify call, database writes and an email: count it first.
  const limited = await throttle(deps);
  if (limited !== null) return { ok: false, code: "rate-limited", retryAfterMs: limited.retryAfterMs };

  let check: Awaited<ReturnType<HostingAdapter["verifyBotCheck"]>>;
  try {
    check = await deps.hosting.verifyBotCheck({
      token,
      host,
      secretRef: target.turnstileSecretName,
      remoteIp: deps.ip,
    });
  } catch {
    logCode("bot-check-unreachable");
    return { ok: false, code: "unavailable" };
  }
  if (!check.ok) {
    if (check.reason !== "not-configured") return { ok: false, code: "bot-check" };
    logCode("bot-check-not-configured");
    return { ok: false, code: "unavailable" };
  }

  const offer = await insertOffer(db, {
    offer: {
      host: target.host,
      amountMinor: fields.amount * MINOR_UNITS_PER_MAJOR,
      currency: config.currency,
      name: fields.name,
      email: fields.email,
      ...(deps.country === undefined ? {} : { country: deps.country }),
      ...(fields.message === undefined ? {} : { message: fields.message }),
    },
    now,
  });

  try {
    const outcome = await sendEmail(deps, target, config.currency, fields);
    await setOfferEmailStatus(db, { id: offer.id, ...outcome, now });
  } catch {
    // The offer is stored; its email status stays `pending`, which the admin shows as not sent.
    logCode("email-status-not-saved");
  }
  return { ok: true };
}
