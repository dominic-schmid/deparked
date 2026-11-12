import type { Currency } from "@deparked/config";
import type { NotificationMessage } from "@deparked/hosting";
import type { OfferFields } from "./fields";

/** `1500` → `1,500`. Written out so Node and workerd agree to the byte. */
export function groupDigits(amount: number): string {
  return String(amount).replace(/\B(?=(\d{3})+$)/g, ",");
}

export function formatAmount(amount: number, currency: Currency): string {
  return `${groupDigits(amount)} ${currency}`;
}

/**
 * The plain-text email to the owner. Values are already validated (no control characters, bounded lengths);
 * the hosting adapter encodes the headers.
 */
export function offerNotification(input: {
  host: string;
  senderHost: string;
  to: string;
  currency: Currency;
  country: string | undefined;
  fields: OfferFields;
}): NotificationMessage {
  const { host, fields } = input;
  const amount = formatAmount(fields.amount, input.currency);
  const lines = [
    `Someone made an offer for ${host}.`,
    "",
    `Offer: ${amount}`,
    `Name: ${fields.name}`,
    `Email: ${fields.email}`,
    ...(input.country === undefined ? [] : [`Country: ${input.country}`]),
    ...(fields.message === undefined ? [] : ["", "Message:", fields.message]),
    "",
    "Reply to this email to answer the buyer directly.",
    `Every offer is also in your admin: https://${host}/admin`,
  ];
  return {
    senderHost: input.senderHost,
    fromName: "Deparked",
    to: input.to,
    replyTo: { email: fields.email, name: fields.name },
    subject: `Offer for ${host}: ${amount}`,
    text: lines.join("\n"),
  };
}
