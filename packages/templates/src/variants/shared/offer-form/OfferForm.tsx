import type { Currency, SentencePart, SentenceSlot } from "@deparked/config";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  currencyName,
  currencySymbol,
  editAmount,
  formatAmount,
  minOfferMessage,
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
  /** The bot check's colours: the page's own, or `auto` for a page that follows the visitor's colour scheme. */
  turnstileTheme: TurnstileTheme;
};

export type TurnstileTheme = "light" | "dark" | "auto";

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
  turnstileTheme,
}: OfferFormProps) {
  const [hydrated, setHydrated] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS);
  const [tag, setTag] = useState<Tag | null>(null);
  const [status, setStatus] = useState<"idle" | "checking" | "sending">("idle");
  const [sent, setSent] = useState<Sent | null>(null);

  const inputs = useRef<Partial<Record<SentenceSlot, HTMLInputElement>>>({});
  const tagRef = useRef<HTMLParagraphElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);
  const lastAmount = useRef("");
  const turnstile = useRef({ token: "", widgetId: "", settle: (_result: string | Error) => {} });

  useEffect(() => setHydrated(true), []);

  // The thank-you replaces the form: focus moves to it, so a screen reader reads it and the keyboard is not lost.
  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

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

  const amountDigits = () => (inputs.current.amount?.value ?? "").replace(/\D/g, "");

  /** What is wrong with a blank as it stands, or "" when nothing is. */
  function problem(slot: SentenceSlot): string {
    const input = inputs.current[slot];
    const value = input?.value.trim() ?? "";
    if (slot === "amount") {
      const amount = Number(amountDigits());
      return !amount ? "Add an amount" : amount < minOffer ? minOfferMessage(minOffer, currency) : "";
    }
    if (slot === "name") return value ? "" : "Add your name";
    return value && input?.checkValidity() ? "" : "Add an email we can reply to";
  }

  function showProblem(slot: SentenceSlot, message: string) {
    setErrors((current) => (current[slot] === message ? current : { ...current, [slot]: message }));
    setTag((current) => (message ? { key: slot, message } : current?.key === slot ? null : current));
  }

  function onInput(slot: SentenceSlot, event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    if (slot === "amount") {
      const edit = (event.nativeEvent as InputEvent).inputType ?? "";
      const next = editAmount(input.value, input.selectionStart ?? input.value.length, lastAmount.current, edit);
      input.value = next.value;
      input.setSelectionRange(next.caret, next.caret);
      lastAmount.current = next.value;
    }
    // a blank in error is checked again as it is typed in, so the message goes as soon as it is fixed
    if (errors[slot]) showProblem(slot, problem(slot));
  }

  // An empty blank is as wide as its placeholder. Held at that width (in em, so it follows the type's size), it
  // grows from there as it is typed into instead of snapping narrower at the first character.
  function holdPlaceholderWidth(input: HTMLInputElement) {
    if (input.value || input.style.minWidth) return;
    const em = input.getBoundingClientRect().width / Number.parseFloat(getComputedStyle(input).fontSize);
    input.style.minWidth = `min(${em.toFixed(3)}em, 100cqi - 1.2em)`;
  }

  // A blank is judged when it is left, not while it is being typed in, and only once there is something in it.
  function onBlur(slot: SentenceSlot) {
    if (inputs.current[slot]?.value.trim()) showProblem(slot, problem(slot));
  }

  // Enter in a blank moves on to the next one, the way the phone keyboard's "Next" key says; in the last, it sends.
  function onKeyDown(slot: SentenceSlot, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    const next = slots[slots.indexOf(slot) + 1];
    if (!next) return;
    event.preventDefault();
    inputs.current[next]?.focus();
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
        theme: turnstileTheme,
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

    const found: FieldErrors = { amount: problem("amount"), name: problem("name"), email: problem("email") };
    setErrors(found);
    const first = slots.find((slot) => found[slot]);
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
      // Cast, not annotated: under the Workers runtime types (the admin imports this package) `json()` is unknown.
      const result = (await response.json().catch(() => ({}))) as Partial<OfferResponse>;
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
        if (input) {
          shake(input);
          input.focus();
        }
      }
      setTag({ key: field ?? "form", message });
      state.token = "";
      if (state.widgetId) window.turnstile?.reset(state.widgetId);
    } finally {
      setStatus("idle");
    }
  }

  const slots = sentence.flatMap((part) => (part.type === "slot" ? [part.slot] : []));
  const staticErrors = offerErrorMessages(minOffer, currency);
  const busy = status !== "idle";
  const marketplaceHost = marketplaceUrl?.startsWith("https://") ? hostOf(marketplaceUrl) : "";

  return (
    <>
      <form method="post" action={endpoint} noValidate={hydrated} hidden={sent !== null} onSubmit={onSubmit}>
        <p className="say">
          {glue(sentence).map((part, index) =>
            part.type === "text" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: the runs of one sentence, in order; a run can repeat
              <span key={index} dir="auto">
                {part.text}
              </span>
            ) : (
              <span className="slot" key={part.slot}>
                {/* an empty label around the blank: tapping near it, above or below, still lands in it */}
                {/* biome-ignore lint/a11y/noLabelWithoutControl: a tap target with no text; the input's name is the label below */}
                <label className="hit" htmlFor={part.slot} aria-hidden="true" />
                {part.slot === "amount" && currencySymbol(currency)}
                <label className="sr-only" htmlFor={part.slot}>
                  {part.slot === "amount" ? `Offer in ${currencyName(currency)}` : SLOT_LABELS[part.slot]}
                </label>
                <input
                  {...SLOT_INPUTS[part.slot]}
                  id={part.slot}
                  name={OFFER_FIELDS[part.slot]}
                  required
                  size={SLOT_INPUTS[part.slot].placeholder.length}
                  enterKeyHint={part.slot === slots.at(-1) ? "send" : "next"}
                  aria-invalid={errors[part.slot] ? "true" : undefined}
                  aria-describedby={`e-${part.slot}`}
                  ref={(element) => {
                    if (element) inputs.current[part.slot] = element;
                  }}
                  onInput={(event) => onInput(part.slot, event)}
                  onFocus={(event) => holdPlaceholderWidth(event.currentTarget)}
                  onBlur={() => onBlur(part.slot)}
                  onKeyDown={(event) => onKeyDown(part.slot, event)}
                  onAnimationEnd={(event) => event.currentTarget.classList.remove("shake")}
                />
                {part.tail}
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
          {/* aria-disabled, not disabled: the button keeps focus while the offer is on its way */}
          <button className="send" type="submit" aria-disabled={busy || undefined}>
            {/* every label takes the same cell, so the button keeps its width as the label changes */}
            <span className="send-text" data-alt={busy ? "Send offer" : "Sending…"}>
              <span>{status === "idle" ? "Send offer" : status === "checking" ? "Checking…" : "Sending…"}</span>
            </span>
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
          <span className="sr-only" role="status">
            {status === "checking" ? "Checking you're not a bot…" : status === "sending" ? "Sending your offer…" : ""}
          </span>
          <noscript>
            <p className="nojs" dir="auto">
              {"Offers need JavaScript for the spam check. "}
              {marketplaceHost ? (
                <>
                  {"Turn it on and reload, or make your offer on "}
                  <a href={marketplaceUrl} rel="noopener noreferrer">
                    {marketplaceHost}
                  </a>
                  .
                </>
              ) : (
                "Turn it on and reload this page to send yours."
              )}
            </p>
          </noscript>
        </div>
      </form>
      <div className="sent" id={OFFER_SENT_FRAGMENT}>
        <h2>Thanks. Your offer is with the owner.</h2>
        <p>Next, the owner reads it. Any reply goes to the email you gave.</p>
      </div>
      <div className="sent" hidden={sent === null} tabIndex={-1} ref={sentRef}>
        {sent && (
          <>
            <h2>
              Thanks, {sent.name}. Your {formatAmount(sent.amount, currency)} offer is with the owner.
            </h2>
            <p>Next, the owner reads it. Any reply goes to {sent.email}.</p>
          </>
        )}
      </div>
    </>
  );
}

const SLOT_INPUTS = {
  amount: { inputMode: "numeric", autoComplete: "off", placeholder: "your price", pattern: "[0-9][0-9.,' ]*" },
  name: {
    autoComplete: "name",
    autoCapitalize: "words",
    maxLength: OFFER_LIMITS.name,
    placeholder: "your name",
    spellCheck: false,
  },
  email: {
    type: "email",
    autoComplete: "email",
    maxLength: OFFER_LIMITS.email,
    placeholder: "you@company.com",
    spellCheck: false,
  },
} as const;

type GluedPart = { type: "text"; text: string } | { type: "slot"; slot: SentenceSlot; tail: ReactNode };

/** Punctuation right after a blank stays with it, so a full blank never leaves a lone full stop on the next line. */
function glue(sentence: SentencePart[]): GluedPart[] {
  const parts: GluedPart[] = [];
  for (const part of sentence) {
    const last = parts.at(-1);
    if (part.type === "text" && last?.type === "slot") {
      const tail = /^[.,;:!?)\]}»”’…،؛؟。、]+/u.exec(part.text)?.[0] ?? "";
      if (tail) {
        last.tail = <span className="tail">{tail}</span>;
        if (part.text.length > tail.length) parts.push({ type: "text", text: part.text.slice(tail.length) });
        continue;
      }
    }
    parts.push(part.type === "slot" ? { ...part, tail: null } : part);
  }
  return parts;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
