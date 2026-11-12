import { HostingError } from "@deparked/hosting";

export interface Mailbox {
  email: string;
  name?: string | undefined;
}

export interface MimeInput {
  from: Mailbox;
  to: string;
  replyTo: Mailbox;
  subject: string;
  text: string;
  date: Date;
  /** Without the angle brackets: `<id>@<host>`. */
  messageId: string;
}

const ADDRESS =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const MAX_ADDRESS_LENGTH = 254;
// "Subject: " plus this stays inside the 78 characters RFC 5322 recommends per line.
const MAX_PLAIN_HEADER_TEXT = 68;
// 39 bytes are 52 base64 characters; with `=?UTF-8?B?` and `?=` one encoded word is 64 characters.
const ENCODED_WORD_BYTES = 39;
const BODY_LINE_LENGTH = 76;

/**
 * An address as it may appear in a header: ASCII only, no spaces, no angle brackets, no line breaks.
 * Anything else is refused, so buyer input can never add a header or a second recipient.
 */
export function assertAddress(email: string, what: string): string {
  if (email.length > MAX_ADDRESS_LENGTH || !ADDRESS.test(email)) {
    throw new HostingError("invalid-input", `The ${what} is not a valid email address.`);
  }
  return email;
}

function isLineBreakOrControl(code: number): boolean {
  return code < 0x20 || code === 0x7f || code === 0x85 || code === 0x2028 || code === 0x2029;
}

/** Free text for a header: every control character and line break becomes a space. */
function singleLine(value: string): string {
  let out = "";
  for (const char of value) out += isLineBreakOrControl(char.codePointAt(0) ?? 0) ? " " : char;
  return out.replace(/ {2,}/g, " ").trim();
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) > 0x7e) return false;
  }
  return true;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** RFC 2047 encoded words, split between characters and folded onto continuation lines. */
function encodedWords(value: string): string {
  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (chunkBytes + size > ENCODED_WORD_BYTES && chunk !== "") {
      words.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += char;
    chunkBytes += size;
  }
  if (chunk !== "") words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${base64(encoder.encode(word))}?=`).join("\r\n ");
}

function headerText(value: string): string {
  const text = singleLine(value);
  return isAscii(text) && text.length <= MAX_PLAIN_HEADER_TEXT ? text : encodedWords(text);
}

function mailbox(input: Mailbox, what: string): string {
  const email = assertAddress(input.email, what);
  const name = singleLine(input.name ?? "");
  if (name === "") return email;
  const phrase =
    isAscii(name) && name.length <= MAX_PLAIN_HEADER_TEXT
      ? `"${name.replace(/[\\"]/g, (char) => `\\${char}`)}"`
      : encodedWords(name);
  return `${phrase} <${email}>`;
}

/** `Thu, 12 Nov 2026 09:30:00 +0000` */
function rfc5322Date(date: Date): string {
  return date.toUTCString().replace(/GMT$/, "+0000");
}

/**
 * A complete RFC 5322 message with a UTF-8 plain-text body. Header values are built only from validated
 * addresses and single-line text, and the body is base64, so no input can break out of its place and no
 * line exceeds the length limits.
 */
export function buildMimeMessage(input: MimeInput): string {
  const body = base64(new TextEncoder().encode(input.text.replace(/\r\n|\r|\n/g, "\r\n")));
  const bodyLines = body.match(new RegExp(`.{1,${BODY_LINE_LENGTH}}`, "g")) ?? [];
  return [
    `From: ${mailbox(input.from, "sender address")}`,
    `To: ${assertAddress(input.to, "notify address")}`,
    `Reply-To: ${mailbox(input.replyTo, "reply address")}`,
    `Subject: ${headerText(input.subject)}`,
    `Date: ${rfc5322Date(input.date)}`,
    `Message-ID: <${assertAddress(input.messageId, "message id")}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    ...bodyLines,
    "",
  ].join("\r\n");
}
