// Fills the LOCAL D1 with dummy domains and offers, worst cases included (long names, unbreakable emails, emoji,
// right-to-left text, huge amounts), to look at the admin in a browser. Run `dev:seed` first. Does nothing when
// the database already has domains. `getPlatformProxy` only ever opens local storage.
import {
  createDb,
  type DomainStatus,
  insertDomain,
  insertNotifyAddress,
  insertOffer,
  listDomains,
  publishConfig,
  setDomainStatus,
  setOfferEmailStatus,
  setOfferStatus,
} from "@deparked/db";
import { getPlatformProxy } from "wrangler";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const VERIFIED = "owner@example.com";
const PENDING = "sales-team-with-a-rather-long-mailbox-name@subdomain.example.org";

const DOMAINS: { host: string; status: DomainStatus; notify?: string; publishedDaysAgo?: number }[] = [
  { host: "example.com", status: "live", notify: VERIFIED, publishedDaysAgo: 2 },
  { host: "example.org", status: "live", notify: PENDING, publishedDaysAgo: 40 },
  { host: "example.net", status: "placeholder", notify: VERIFIED },
  { host: "off.example", status: "off", notify: VERIFIED, publishedDaysAgo: 400 },
  { host: "broken.example", status: "error" },
  { host: "a.example", status: "live", notify: VERIFIED, publishedDaysAgo: 0 },
  {
    host: "the-longest-domain-name-anyone-would-reasonably-register-for-sale.example",
    status: "live",
    notify: VERIFIED,
  },
  { host: "xn--mnchen-3ya.example", status: "live", notify: VERIFIED, publishedDaysAgo: 9 },
  { host: "sub.domain.with.many.labels.and.even.more.labels.example.com", status: "placeholder" },
  { host: "best-coffee-roasters-of-northern-europe.example", status: "live", notify: VERIFIED, publishedDaysAgo: 1 },
  { host: "zero-offers.example", status: "live", notify: VERIFIED, publishedDaysAgo: 3 },
  { host: "0123456789-0123456789-0123456789-0123456789-0123456789-0123456.example", status: "off" },
];

const LONG_NAME = "Wolfeschlegelsteinhausenbergerdorff ".repeat(6).trim().slice(0, 200);
const LONG_EMAIL = `${"averyveryverylongmailboxnamewithoutanybreaks".repeat(2)}@${"sub".repeat(20)}.example.com`;
const LONG_MESSAGE =
  "We have been looking for exactly this name for our new product line and would like to move quickly. ".repeat(8);

const BUYERS: { name: string; email: string; country?: string; message?: string }[] = [
  { name: "Ada Lovelace", email: "ada@example.com", country: "GB", message: "Is the price negotiable?" },
  { name: LONG_NAME, email: LONG_EMAIL, country: "DE", message: LONG_MESSAGE },
  { name: "X", email: "x@example.com" },
  { name: "🚀🔥 Crypto Bro 💎🙌", email: "moon@example.com", country: "US", message: "🚀🚀🚀 will pay in 🪙" },
  {
    name: "محمد بن عبد الله",
    email: "buyer@example.org",
    country: "SA",
    message: "مرحبا، أود شراء هذا النطاق. ما هو أقل سعر؟",
  },
  { name: "山田 太郎", email: "yamada@example.jp", country: "JP", message: "このドメインに興味があります。" },
  { name: '=HYPERLINK("http://example.com","click")', email: "formula@example.com", message: "+1 (555) 0100" },
  {
    name: "<script>alert(1)</script>",
    email: "xss@example.com",
    country: "ZZ",
    message: "<img src=x onerror=alert(1)>",
  },
  { name: "Nomessage Buyer", email: "quiet@example.net", country: "FR" },
  { name: "Line\nBreak", email: "lines@example.com", message: "First line\n\nSecond paragraph\n\tindented" },
];

const AMOUNTS: [number, string][] = [
  [150_000, "USD"],
  [9_007_199_254_740_991, "USD"],
  [1, "EUR"],
  [5_000_000, "JPY"],
  [250_000_00, "CHF"],
  [99_999_999_999, "GBP"],
  [0, "USD"],
  [1_234_567, "KWD"],
];

const OFFER_HOSTS = ["example.com", "example.com", "example.org", "a.example", DOMAINS[6]?.host ?? "", "off.example"];

const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: "wrangler.jsonc" });
try {
  const db = createDb(proxy.env.DB);
  if ((await listDomains(db, { includeRemoved: true })).length > 0) {
    console.log("The local database already has domains: nothing added.");
  } else {
    const now = Date.now();
    await insertNotifyAddress(db, {
      email: VERIFIED,
      cfAddressId: "demo-1",
      verifiedAt: now - 30 * DAY,
      now: now - 30 * DAY,
    });
    await insertNotifyAddress(db, { email: PENDING, cfAddressId: "demo-2", now: now - 2 * HOUR });
    for (const domain of DOMAINS) {
      await insertDomain(db, {
        domain: { host: domain.host, zoneId: "demo-zone", ...(domain.notify ? { notifyEmail: domain.notify } : {}) },
        now: now - 60 * DAY,
      });
      if (domain.status !== "placeholder") await setDomainStatus(db, { host: domain.host, status: domain.status, now });
      if (domain.publishedDaysAgo !== undefined) {
        await publishConfig(db, {
          host: domain.host,
          json: "{}",
          schemaVersion: 1,
          release: null,
          now: now - domain.publishedDaysAgo * DAY - HOUR,
        });
      }
    }
    for (let index = 0; index < 32; index++) {
      const buyer = BUYERS[index % BUYERS.length];
      const amount = AMOUNTS[index % AMOUNTS.length];
      const host = OFFER_HOSTS[index % OFFER_HOSTS.length];
      if (buyer === undefined || amount === undefined || host === undefined) continue;
      const at = now - index * 7 * HOUR - 5 * 60_000;
      const offer = await insertOffer(db, {
        offer: { host, amountMinor: amount[0], currency: amount[1], ...buyer },
        now: at,
      });
      if (index % 5 === 3) await setOfferStatus(db, { id: offer.id, status: "replied", now: at });
      if (index % 7 === 6) await setOfferStatus(db, { id: offer.id, status: "ignored", now: at });
      if (index % 6 === 1) {
        await setOfferEmailStatus(db, { id: offer.id, emailStatus: "failed", emailError: "unavailable", now: at });
      } else {
        await setOfferEmailStatus(db, { id: offer.id, emailStatus: "sent", notifiedTo: VERIFIED, now: at });
      }
    }
    console.log(`Added ${DOMAINS.length} domains, 2 notify addresses and 32 offers to the local database.`);
  }
} finally {
  await proxy.dispose();
}
