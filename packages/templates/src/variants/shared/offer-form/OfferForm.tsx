import type { Currency, SentencePart, SentenceSlot } from "@deparked/config";
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  currencyName,
  currencySymbol,
  formatAmount,
  groupDigits,
  OFFER_ERROR_REASONS,
  OFFER_FIELDS,
  OFFER_LIMITS,
  OFFER_SENT_FRAGMENT,
  type OfferField,
  type OfferRequest,
  type OfferResponse,
  offerErrorFragment,
  offerErrorMessages,
} from "../../../offer";

export type OfferFormProps = {
  endpoint: string;
  sitekey: string;
  currency: Currency;
  minOffer: number;
  sentence: SentencePart[];
  finePrint: string;
  marketplaceUrl?: string;
};

type Turnstile = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  execute(container: HTMLElement): void;
  reset(widgetId: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

type FieldErrors = Record<OfferField, string>;
/** The one visible message: a field's, or the whole form's (`key: "form"`). */
type Tag = { key: OfferField | "form"; message: string };
type Sent = { name: string; email: string; amount: number };

const NO_ERRORS: FieldErrors = { amount: "", name: "", email: "" };
const SLOT_LABELS = { name: "Your name", email: "Your email" } as const;
const TOKEN_TIMEOUT_MS = 60_000;

class OfferError extends Error {
  readonly field: OfferField | undefined;
  constructor(message: string, field?: OfferField) {
    super(message);
    this.field = field;
  }
}

/**
 * The offer as one sentence with three blanks. Server-rendered it is a plain form that posts to the endpoint;
 * hydrated it checks the amount at once, runs Turnstile only when Send is pressed and shows errors in place.
 */
export function OfferForm({
  endpoint,
  sitekey,
  currency,
  minOffer,
  sentence,
  finePrint,
  marketplaceUrl,
}: OfferFormProps) {
  const [hydrated, setHydrated] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS);
  const [tag, setTag] = useState<Tag | null>(null);
  const [status, setStatus] = useState<"idle" | "checking" | "sending">("idle");
  const [sent, setSent] = useState<Sent | null>(null);

  const inputs = useRef<Partial<Record<SentenceSlot, HTMLInputElement>>>({});
  const tagRef = useRef<HTMLParagraphElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const turnstile = useRef({ token: "", widgetId: "", settle: (_result: string | Error) => {} });

  useEffect(() => setHydrated(true), []);

  // Replay the tag's entrance for every new message, also when the text is the same as the last one.
  useLayoutEffect(() => {
    const element = tagRef.current;
    if (!element || !tag) return;
    element.style.animation = "none";
    void element.offsetWidth;
    element.style.animation = "";
  }, [tag]);

  function shake(element: HTMLElement) {
    element.classList.remove("shake");
    void element.offsetWidth;
    element.classList.add("shake");
  }

  const amountDigits = () =>
    (inputs.current.amount?.value ?? "").replace(/\D/g, "").slice(0, OFFER_LIMITS.amountDigits);

  function onInput(slot: SentenceSlot) {
    const input = inputs.current.amount;
    if (slot === "amount" && input) {
      const digits = amountDigits();
      input.value = digits ? groupDigits(Number(digits)) : "";
    }
    setErrors((current) => (current[slot] ? { ...current, [slot]: "" } : current));
    setTag((current) => (current?.key === slot ? null : current));
  }

  // Cloudflare's check runs only when Send is pressed; its box appears only if Cloudflare needs a click,
  // and fades out once passed.
  function getToken(): Promise<string> {
    const state = turnstile.current;
    const box = boxRef.current;
    if (state.token) return Promise.resolve(state.token);
    if (!window.turnstile || !box) {
      return Promise.reject(new OfferError("The security check didn't load. Reload the page."));
    }
    const api = window.turnstile;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new OfferError("The security check took too long. Try again.")),
        TOKEN_TIMEOUT_MS,
      );
      state.settle = (result) => {
        clearTimeout(timeout);
        if (typeof result === "string") resolve(result);
        else reject(result);
      };
      box.hidden = false;
      box.classList.remove("passed");
      state.widgetId ||= api.render(box, {
        sitekey,
        theme: "dark",
        appearance: "interaction-only",
        execution: "execute",
        callback: (token: string) => {
          state.token = token;
          state.settle(token);
          setTimeout(() => {
            box.classList.add("passed");
            setTimeout(() => {
              box.hidden = true;
            }, 400);
          }, 900);
        },
        "expired-callback": () => {
          state.token = "";
        },
        "error-callback": () => {
          state.token = "";
          state.settle(new OfferError("The security check didn't pass. Try again."));
          return true;
        },
      });
      api.execute(box);
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status !== "idle") return;
    const { amount: amountInput, name: nameInput, email: emailInput } = inputs.current;
    if (!amountInput || !nameInput || !emailInput) return;
    const honeypot = new FormData(event.currentTarget).get(OFFER_FIELDS.honeypot)?.toString() ?? "";
    const amount = Number(amountDigits());
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();

    const found: FieldErrors = {
      amount: !amount
        ? "Add an amount"
        : amount < minOffer
          ? `Offers start at ${formatAmount(minOffer, currency)}`
          : "",
      name: name ? "" : "Add your name",
      email: email && emailInput.checkValidity() ? "" : "Add an email we can reply to",
    };
    setErrors(found);
    const first = sentence.flatMap((part) => (part.type === "slot" && found[part.slot] ? [part.slot] : []))[0];
    if (first) {
      setTag({ key: first, message: found[first] });
      const input = inputs.current[first];
      if (input) {
        shake(input);
        input.focus();
      }
      return;
    }
    setTag(null);

    const state = turnstile.current;
    setStatus(state.token ? "sending" : "checking");
    try {
      const token = await getToken();
      setStatus("sending");
      const body: OfferRequest = {
        amount,
        name,
        email,
        website: honeypot,
        "cf-turnstile-response": token,
      };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      const result: Partial<OfferResponse> = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failed = result.ok === false ? result : undefined;
        throw new OfferError(failed?.error || "That didn't go through. Try again in a minute.", failed?.field);
      }
      setSent({ name, email, amount });
    } catch (error) {
      const field = error instanceof OfferError ? error.field : undefined;
      const message = error instanceof OfferError ? error.message : "That didn't go through. Try again in a minute.";
      if (field) {
        setErrors((current) => ({ ...current, [field]: message }));
        const input = inputs.current[field];
        if (input) shake(input);
      }
      setTag({ key: field ?? "form", message });
      state.token = "";
      if (state.widgetId) window.turnstile?.reset(state.widgetId);
    } finally {
      setStatus("idle");
    }
  }

  const staticErrors = offerErrorMessages(minOffer, currency);
  const marketplaceHost = marketplaceUrl?.startsWith("https://") ? hostOf(marketplaceUrl) : "";

  return (
    <>
      <form method="post" action={endpoint} noValidate={hydrated} hidden={sent !== null} onSubmit={onSubmit}>
        <p className="say">
          {sentence.map((part, index) =>
            part.type === "text" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one sentence, in order; a run can repeat
              <span key={index} dir="auto">
                {part.text}
              </span>
            ) : (
              <span className="slot" key={part.slot}>
                {part.slot === "amount" && currencySymbol(currency)}
                <label className="sr-only" htmlFor={part.slot}>
                  {part.slot === "amount" ? `Offer in ${currencyName(currency)}` : SLOT_LABELS[part.slot]}
                </label>
                <input
                  {...SLOT_INPUTS[part.slot]}
                  id={part.slot}
                  name={OFFER_FIELDS[part.slot]}
                  required
                  aria-invalid={errors[part.slot] ? "true" : undefined}
                  aria-describedby={`e-${part.slot}`}
                  ref={(element) => {
                    if (element) inputs.current[part.slot] = element;
                  }}
                  onInput={() => onInput(part.slot)}
                  onAnimationEnd={(event) => event.currentTarget.classList.remove("shake")}
                />
                <span className="sr-only" id={`e-${part.slot}`}>
                  {errors[part.slot]}
                </span>
              </span>
            ),
          )}
        </p>
        <input className="hp" name={OFFER_FIELDS.honeypot} tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <div className="row">
          {(finePrint || marketplaceHost) && (
            <p className="fine" dir="auto">
              {finePrint}
              {finePrint && marketplaceHost && " "}
              {marketplaceHost && (
                <a href={marketplaceUrl} rel="noopener noreferrer">
                  {`Also listed on ${marketplaceHost}`}
                </a>
              )}
            </p>
          )}
          {OFFER_ERROR_REASONS.map((reason) => (
            <p className="tag" id={offerErrorFragment(reason)} key={reason}>
              {staticErrors[reason]}
            </p>
          ))}
          <p className="tag" id="e-form" role="alert" ref={tagRef}>
            {tag?.message}
          </p>
          <div className="cf-turnstile" ref={boxRef} />
          <button className="send" type="submit" disabled={status !== "idle"}>
            <span>{status === "idle" ? "Send offer" : status === "checking" ? "Checking…" : "Sending…"}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3 8h10m0 0-4-4m4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </form>
      <div className="sent" id={OFFER_SENT_FRAGMENT}>
        <h2>Thanks. Your offer is with the owner.</h2>
        <p>The reply goes to the email you gave.</p>
      </div>
      <div className="sent" hidden={sent === null} aria-live="polite">
        {sent && (
          <>
            <h2>
              Thanks, {sent.name}. Your {formatAmount(sent.amount, currency)} offer is with the owner.
            </h2>
            <p>The reply goes to {sent.email}.</p>
          </>
        )}
      </div>
    </>
  );
}

const SLOT_INPUTS = {
  amount: { inputMode: "numeric", autoComplete: "off", placeholder: "your price", pattern: "[0-9][0-9.,' ]*" },
  name: { autoComplete: "name", maxLength: OFFER_LIMITS.name, placeholder: "your name", spellCheck: false },
  email: {
    type: "email",
    autoComplete: "email",
    maxLength: OFFER_LIMITS.email,
    placeholder: "you@company.com",
    spellCheck: false,
  },
} as const;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
