import {
  formatAmount,
  OFFER_FIELDS,
  OFFER_SENT_FRAGMENT,
  type OfferErrorReason,
  offerErrorFragment,
} from "@deparked/templates";
import { type OfferDeps, type OfferFailure, type OfferInput, type OfferResult, submitOffer } from "./submit";

export const MAX_BODY_BYTES = 10 * 1024;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** What the route reads from the Worker's environment; the rest of `OfferDeps` comes from the request. */
export type OfferEnv = Pick<OfferDeps, "db" | "hosting" | "sessionKey" | "now">;

type HttpFailure = OfferFailure | { ok: false; code: "invalid"; status: 405 | 413 | 415 };

const STATUS: Record<OfferFailure["code"], number> = {
  invalid: 400,
  "min-offer": 400,
  "bot-check": 403,
  "rate-limited": 429,
  "not-for-sale": 404,
  unavailable: 503,
};

const FIELD_MESSAGES = {
  amount: "Enter a whole amount, like 1500",
  name: "Add your name",
  email: "Add an email we can reply to",
} as const;

/** One sentence the lander shows the buyer as it is. */
function message(failure: HttpFailure): string {
  switch (failure.code) {
    case "invalid":
      return "field" in failure && failure.field !== undefined
        ? FIELD_MESSAGES[failure.field]
        : "Check the form and send again";
    case "min-offer":
      return `Offers start at ${formatAmount(failure.minOffer, failure.currency)}`;
    case "bot-check":
      return "The security check didn't pass. Try again";
    case "rate-limited":
      return "Too many offers from here. Try again later";
    case "not-for-sale":
      return "This domain doesn't take offers here";
    case "unavailable":
      return "That didn't go through. Try again in a minute";
  }
}

function errorReason(failure: HttpFailure): OfferErrorReason {
  if (failure.code === "min-offer") return "amount";
  if (failure.code === "invalid" && "field" in failure && failure.field !== undefined) return failure.field;
  if (failure.code === "bot-check") return "check";
  if (failure.code === "rate-limited") return "rate";
  return "failed";
}

/** The fragment of the static page that holds the message for a no-JavaScript submission. */
function fragment(result: { ok: true } | HttpFailure): string {
  return result.ok ? OFFER_SENT_FRAGMENT : offerErrorFragment(errorReason(result));
}

function respond(wantsJson: boolean, result: { ok: true } | HttpFailure): Response {
  // No CORS headers: another site's script cannot read the answer, and its JSON post fails the preflight.
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  if (!result.ok && "status" in result && result.status === 405) headers.set("Allow", "POST");
  if (!result.ok && result.code === "rate-limited") {
    headers.set("Retry-After", String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
  }
  if (!wantsJson) {
    // A path on this host and a fixed fragment: nothing from the request reaches the Location.
    headers.set("Location", `/#${fragment(result)}`);
    return new Response(null, { status: 303, headers });
  }
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (result.ok) return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  const status = "status" in result ? result.status : STATUS[result.code];
  const field = "field" in result && result.field !== undefined ? { field: result.field } : {};
  const body = { ok: false, error: message(result), code: result.code, ...field };
  return new Response(JSON.stringify(body), { status, headers });
}

/** The body as text, or null when it is larger than `MAX_BODY_BYTES` (whatever `Content-Length` claims). */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_BODY_BYTES);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    bytes.set(value, length);
    length += value.length;
  }
  return new TextDecoder().decode(bytes.subarray(0, length));
}

function parseBody(isJson: boolean, text: string): Record<string, unknown> | null {
  if (!isJson) {
    const form = new URLSearchParams(text);
    return Object.fromEntries([...form.keys()].map((key) => [key, form.get(key)]));
  }
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * `POST /api/offer`. A JSON request (JSON body, or `Accept: application/json`) is answered with JSON
 * `{ ok: true }` or `{ ok: false, error, code, field? }`; a plain form post with `303` to `/#offer-sent` or
 * `/#offer-error-<reason>` on the same host.
 */
export async function handleOffer(request: Request, env: OfferEnv): Promise<Response> {
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  const isJson = contentType === "application/json";
  const wantsJson = isJson || (request.headers.get("accept") ?? "").toLowerCase().includes("application/json");

  if (request.method !== "POST") return respond(true, { ok: false, code: "invalid", status: 405 });
  if (!isJson && contentType !== "application/x-www-form-urlencoded") {
    return respond(wantsJson, { ok: false, code: "invalid", status: 415 });
  }
  const text = await readBody(request);
  if (text === null) return respond(wantsJson, { ok: false, code: "invalid", status: 413 });
  const body = parseBody(isJson, text);
  if (body === null) return respond(wantsJson, { ok: false, code: "invalid" });

  const input: OfferInput = {
    amount: body[OFFER_FIELDS.amount],
    name: body[OFFER_FIELDS.name],
    email: body[OFFER_FIELDS.email],
    message: body[OFFER_FIELDS.message],
    honeypot: body[OFFER_FIELDS.honeypot],
    token: body[OFFER_FIELDS.turnstile],
  };
  const host = new URL(request.url).hostname.toLowerCase();
  // Cloudflare sets both headers itself and overwrites what a client sends. Without the address every visitor
  // would share one throttle counter, so that is only accepted in local dev.
  const ip = request.headers.get("CF-Connecting-IP") ?? (LOOPBACK_HOSTS.has(host) ? "local" : null);
  if (ip === null) {
    console.error("offer: no-client-ip");
    return respond(wantsJson, { ok: false, code: "unavailable" });
  }
  const country = request.headers.get("CF-IPCountry") ?? "";
  let result: OfferResult;
  try {
    result = await submitOffer(
      {
        ...env,
        ip,
        country: /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : undefined,
        host,
      },
      input,
    );
  } catch {
    console.error("offer: internal-error");
    result = { ok: false, code: "unavailable" };
  }
  return respond(wantsJson, result);
}
