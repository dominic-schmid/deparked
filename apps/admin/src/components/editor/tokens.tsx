import { cn } from "@deparked/ui/lib/utils";
import { Check, Plus } from "lucide-react";
import type { RefObject } from "react";

/** `{domain}` is filled in with the host; the other three become the offer form's boxes, once each. */
export type TokenName = "domain" | "amount" | "name" | "email";

const SLOTS: ReadonlySet<TokenName> = new Set(["amount", "name", "email"]);

/** How often `{token}` appears in `text`. */
export function tokenCount(text: string, token: TokenName): number {
  return text.split(`{${token}}`).length - 1;
}

/**
 * `text` with `{token}` put in at `start`..`end` (replacing a selection), a space before it when it would touch a
 * word. Returns the new text and where the caret goes, right after the token.
 */
export function insertToken(
  text: string,
  token: TokenName,
  start: number,
  end: number,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const gap = before === "" || /\s$/.test(before) ? "" : " ";
  const inserted = `${gap}{${token}}`;
  return { text: `${before}${inserted}${text.slice(end)}`, caret: start + inserted.length };
}

/** One line under the chips: what the coloured words turn into. */
function hint(tokens: readonly TokenName[], host: string): string {
  const domain = `The blue word becomes ${host}.`;
  return tokens.some((token) => SLOTS.has(token))
    ? `Orange words become the boxes buyers fill in, once each. ${domain}`
    : domain;
}

/**
 * The fill-in words a text field takes, as chips: a click puts one in at the caret, or selects it when it is already
 * there once. An orange chip with a dashed edge is missing; one in red is there more than once.
 */
export function TokenChips(props: {
  id: string;
  tokens: readonly TokenName[];
  host: string;
  value: string;
  control: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  hint: boolean;
  onChange: (next: string) => void;
}) {
  function press(token: TokenName) {
    const element = props.control.current;
    if (element === null) return;
    const count = tokenCount(props.value, token);
    if (SLOTS.has(token) && count > 0) {
      const at = props.value.indexOf(`{${token}}`);
      element.focus();
      element.setSelectionRange(at, at + token.length + 2);
      return;
    }
    const start = element.selectionStart ?? props.value.length;
    const end = element.selectionEnd ?? start;
    const next = insertToken(props.value, token, start, end);
    props.onChange(next.text);
    // After React has written the new value, the caret sits right after the word.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(next.caret, next.caret);
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <fieldset className="flex min-w-0 flex-wrap gap-1.5">
        <legend className="sr-only">Fill-in words</legend>
        {props.tokens.map((token) => {
          const slot = SLOTS.has(token);
          const count = tokenCount(props.value, token);
          const state = !slot ? "add" : count === 0 ? "missing" : count === 1 ? "used" : "twice";
          const label =
            state === "used"
              ? `{${token}} is in the text. Select it`
              : state === "twice"
                ? `{${token}} is in the text ${count} times; keep one. Select the first`
                : `Insert {${token}}`;
          return (
            <button
              key={token}
              type="button"
              aria-label={label}
              // Keeps the caret where it is in the field, so the word goes in there.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => press(token)}
              className={cn(
                "inline-flex min-h-8 items-center gap-1 rounded-lg border-[1.5px] border-transparent px-2 text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 motion-reduce:transition-none",
                slot
                  ? "bg-[#ffd9cc] text-[#5c1d08] hover:bg-[#ffc9b6] dark:bg-[#4a2619] dark:text-[#ffd9cc] dark:hover:bg-[#5a2e1e]"
                  : "bg-[#d9e2ff] text-[#16245c] hover:bg-[#c8d4ff] dark:bg-[#232d57] dark:text-[#d9e2ff] dark:hover:bg-[#2c3868]",
                state === "missing" && "border-dashed border-current bg-transparent dark:bg-transparent",
                state === "twice" && "border-destructive",
              )}
            >
              {state === "used" ? (
                <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
              ) : state === "twice" ? null : (
                <Plus aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
              )}
              <span aria-hidden="true">
                <span className="opacity-50">{"{"}</span>
                {token}
                <span className="opacity-50">{"}"}</span>
              </span>
              {state === "twice" ? (
                <span aria-hidden="true" className="text-destructive">
                  ×{count}
                </span>
              ) : null}
            </button>
          );
        })}
      </fieldset>
      {props.hint ? (
        <p id={props.id} className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {hint(props.tokens, props.host)}
        </p>
      ) : null}
    </div>
  );
}
