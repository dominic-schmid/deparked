import { SENTENCE_SLOTS, type SentenceSlot } from "./schema";

/** Replaces `{domain}` in a copy field with the host the page is rendered for. Returns plain text: escape it. */
export function fillDomain(text: string, host: string): string {
  return text.replaceAll("{domain}", host);
}

export type SentencePart = { type: "text"; text: string } | { type: "slot"; slot: SentenceSlot };

/** Splits the offer sentence into text runs (with `{domain}` filled in) and the three form-field slots, in order. */
export function sentenceParts(sentence: string, host: string): SentencePart[] {
  const slots = new RegExp(`\\{(${SENTENCE_SLOTS.join("|")})\\}`);
  return sentence
    .split(slots)
    .map(
      (piece, index): SentencePart =>
        index % 2 === 1
          ? { type: "slot", slot: piece as SentenceSlot }
          : { type: "text", text: fillDomain(piece, host) },
    )
    .filter((part) => part.type === "slot" || part.text !== "");
}
