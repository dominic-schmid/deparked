import {
  deleteNotifyAddress,
  getDomain,
  getNotifyAddress,
  insertDomain,
  insertNotifyAddress,
  listNotifyAddresses,
  updateDomain,
} from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { HostingError } from "@deparked/hosting";
import { createFakeHosting } from "@deparked/hosting/testing";
import { describe, expect, test } from "vitest";
import {
  addNotifyAddress,
  fillMissingNotifyAddresses,
  notifyEmailSchema,
  pickNotifyAddress,
  refreshNotifyAddresses,
  removeNotifyAddress,
  resendNotifyAddress,
  waitWords,
} from "./notify";
import { defaultNotifyAddress, offerMail } from "./notify-default";
import { HOST, NOTIFY, NOW, seed } from "./test-seed";

const SECOND = "second@example.com";

async function setup() {
  const { db } = await createTestDb();
  await seed(db);
  const hosting = createFakeHosting({ verifiedAddresses: [NOTIFY] });
  return { db, hosting };
}

describe("add", () => {
  test("sends the verification mail and lists the address as pending", async () => {
    const { db, hosting } = await setup();

    const result = await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });

    expect(result.ok).toBe(true);
    expect(hosting.verificationMails).toEqual([SECOND]);
    const row = await getNotifyAddress(db, SECOND);
    expect(row).toMatchObject({ email: SECOND, verifiedAt: null, createdAt: NOW, lastResentAt: NOW });
    expect(row?.cfAddressId).toBeTruthy();
  });

  test("adding it twice sends one mail", async () => {
    const { db, hosting } = await setup();
    await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });
    expect((await addNotifyAddress(db, hosting, { email: SECOND, now: NOW + 1 })).ok).toBe(true);
    expect(hosting.verificationMails).toEqual([SECOND]);
    expect(await listNotifyAddresses(db)).toHaveLength(2);
  });

  test("an address the host already verified is listed as verified", async () => {
    const { db } = await setup();
    const hosting = createFakeHosting({ verifiedAddresses: [NOTIFY, SECOND] });
    await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });
    expect((await getNotifyAddress(db, SECOND))?.verifiedAt).not.toBeNull();
    expect(hosting.verificationMails).toEqual([]);
  });

  test("a second request that added it first is not an error", async () => {
    const { db, hosting } = await setup();
    const racing = {
      ...hosting,
      notifyAddresses: {
        ...hosting.notifyAddresses,
        async add(email: string) {
          const address = await hosting.notifyAddresses.add(email);
          await insertNotifyAddress(db, { email, cfAddressId: address.id, now: NOW });
          return address;
        },
      },
    };

    expect(await addNotifyAddress(db, racing, { email: SECOND, now: NOW })).toEqual({
      ok: true,
      message: `${SECOND} is already on the list.`,
    });
    expect(await listNotifyAddresses(db)).toHaveLength(2);
  });

  test("removing and adding again cannot mail an address more than five times in six hours", async () => {
    const { db, hosting } = await setup();
    for (let round = 0; round < 5; round++) {
      expect((await addNotifyAddress(db, hosting, { email: SECOND, now: NOW + round })).ok).toBe(true);
      expect((await removeNotifyAddress(db, hosting, { email: SECOND, now: NOW })).ok).toBe(true);
    }

    const sixth = await addNotifyAddress(db, hosting, { email: SECOND, now: NOW + 10 });

    expect(sixth.ok).toBe(false);
    expect(sixth.message).toContain("at most 5 to one address in 6 hours");
    expect(sixth.message).toContain("You can send the next one in about 6 hours.");
    expect(hosting.verificationMails).toHaveLength(5);
    expect(await getNotifyAddress(db, SECOND)).toBeUndefined();
    expect((await addNotifyAddress(db, hosting, { email: SECOND, now: NOW + 6 * 3_600_000 + 10 })).ok).toBe(true);
  });

  test("a failed Cloudflare call does not use up the allowance", async () => {
    const { db, hosting } = await setup();
    for (let round = 0; round < 6; round++) {
      hosting.failNext("notifyAddresses", new HostingError("unavailable", "Cloudflare is down."));
      expect((await addNotifyAddress(db, hosting, { email: SECOND, now: NOW + round })).ok).toBe(false);
    }

    expect((await addNotifyAddress(db, hosting, { email: SECOND, now: NOW + 10 })).ok).toBe(true);
    expect(hosting.verificationMails).toEqual([SECOND]);
  });

  test("parallel adds of one address cannot get past the per-address limit", async () => {
    const { db, hosting } = await setup();

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => addNotifyAddress(db, hosting, { email: SECOND, now: NOW + i })),
    );

    expect(hosting.verificationMails.length).toBeLessThanOrEqual(5);
    expect(results.filter((result) => result.ok).length).toBeGreaterThanOrEqual(1);
  });

  test("a session cannot mail more than twenty different addresses in an hour", async () => {
    const { db, hosting } = await setup();
    for (let n = 0; n < 20; n++) {
      expect((await addNotifyAddress(db, hosting, { email: `buyer${n}@example.com`, now: NOW + n })).ok).toBe(true);
    }

    const twenty1st = await addNotifyAddress(db, hosting, { email: "buyer20@example.com", now: NOW + 100 });

    expect(twenty1st.ok).toBe(false);
    expect(twenty1st.message).toContain("at most 20 an hour across all addresses");
    expect(twenty1st.message).toContain("in about 60 minutes");
    expect(hosting.verificationMails).toHaveLength(20);
    expect((await addNotifyAddress(db, hosting, { email: "buyer20@example.com", now: NOW + 3_600_000 + 100 })).ok).toBe(
      true,
    );
  });

  test("a rejected token is reported as such, and nothing is stored", async () => {
    const { db, hosting } = await setup();
    hosting.failNext("notifyAddresses", new HostingError("credentials-rejected", "Cloudflare refused the token."));

    const result = await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });

    expect(result).toEqual({ ok: false, message: "Cloudflare refused the token.", credentialsRejected: true });
    expect(await getNotifyAddress(db, SECOND)).toBeUndefined();
  });

  test("the input is trimmed, lowercased and must be an email address", () => {
    expect(notifyEmailSchema.parse({ email: "  Owner@Example.COM " })).toEqual({ email: "owner@example.com" });
    expect(notifyEmailSchema.safeParse({ email: "not an address" }).success).toBe(false);
    expect(notifyEmailSchema.safeParse({ email: "" }).success).toBe(false);
  });
});

describe("resend", () => {
  test("sends again, stores the new id, and waits a minute before the next one", async () => {
    const { db, hosting } = await setup();
    await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });
    const before = await getNotifyAddress(db, SECOND);

    expect(await resendNotifyAddress(db, hosting, { email: SECOND, now: NOW + 1000 })).toEqual({
      ok: false,
      message: `A verification email went to ${SECOND} less than a minute ago, and it can take a minute to arrive. You can send another in a minute.`,
    });
    expect((await resendNotifyAddress(db, hosting, { email: SECOND, now: NOW + 61_000 })).ok).toBe(true);
    const after = await getNotifyAddress(db, SECOND);
    expect(after?.cfAddressId).not.toBe(before?.cfAddressId);
    expect(after?.lastResentAt).toBe(NOW + 61_000);
    expect(hosting.verificationMails).toEqual([SECOND, SECOND]);
  });

  test("an address removed while its mail went out is reported, not a crash", async () => {
    const { db, hosting } = await setup();
    await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });
    const racing = {
      ...hosting,
      notifyAddresses: {
        ...hosting.notifyAddresses,
        async resend(id: string) {
          const address = await hosting.notifyAddresses.resend(id);
          await deleteNotifyAddress(db, SECOND);
          return address;
        },
      },
    };

    expect(await resendNotifyAddress(db, racing, { email: SECOND, now: NOW + 61_000 })).toEqual({
      ok: false,
      message: "That address is not on the list any more.",
    });
  });

  test("an address the host lost is added again", async () => {
    const { db, hosting } = await setup();
    await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });
    const row = await getNotifyAddress(db, SECOND);
    await hosting.notifyAddresses.remove(row?.cfAddressId ?? "");

    expect((await resendNotifyAddress(db, hosting, { email: SECOND, now: NOW + 61_000 })).ok).toBe(true);
    expect((await hosting.notifyAddresses.list()).map((address) => address.email)).toContain(SECOND);
  });

  test("a verified address gets no mail", async () => {
    const { db, hosting } = await setup();
    expect((await resendNotifyAddress(db, hosting, { email: NOTIFY, now: NOW })).ok).toBe(true);
    expect(hosting.verificationMails).toEqual([]);
  });
});

describe("remove", () => {
  test("is refused while a domain sends its offers there", async () => {
    const { db, hosting } = await setup();

    const result = await removeNotifyAddress(db, hosting, { email: NOTIFY, now: NOW });

    expect(result.ok).toBe(false);
    expect(result.message).toContain(HOST);
    expect(await getNotifyAddress(db, NOTIFY)).toBeDefined();
  });

  test("a pending address is deleted here and at the host", async () => {
    const { db, hosting } = await setup();
    await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });

    expect((await removeNotifyAddress(db, hosting, { email: SECOND, now: NOW })).ok).toBe(true);

    expect(await getNotifyAddress(db, SECOND)).toBeUndefined();
    expect((await hosting.notifyAddresses.list()).map((address) => address.email)).toEqual([NOTIFY]);
  });

  test("a verified address leaves the list but stays at the host", async () => {
    const { db, hosting } = await setup();
    await updateDomain(db, { host: HOST, patch: { notifyEmail: null }, now: NOW });

    const result = await removeNotifyAddress(db, hosting, { email: NOTIFY, now: NOW });

    expect(result.ok).toBe(true);
    expect(await getNotifyAddress(db, NOTIFY)).toBeUndefined();
    expect((await hosting.notifyAddresses.list()).map((address) => address.email)).toEqual([NOTIFY]);
  });

  test("a host failure keeps the address", async () => {
    const { db, hosting } = await setup();
    await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });
    hosting.failNext("notifyAddresses", new HostingError("unavailable", "Cloudflare did not answer."));

    expect(await removeNotifyAddress(db, hosting, { email: SECOND, now: NOW })).toEqual({
      ok: false,
      message: "Cloudflare did not answer just now, so nothing was changed. Try again in a minute.",
      detail: "Cloudflare did not answer.",
    });
    expect(await getNotifyAddress(db, SECOND)).toBeDefined();
  });
});

describe("check now", () => {
  test("marks an address verified once the host says so, and pending again when the host lost it", async () => {
    const { db, hosting } = await setup();
    await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });
    hosting.verifyAddress(SECOND);

    expect(await refreshNotifyAddresses(db, hosting, { now: NOW + 10 })).toEqual({
      ok: true,
      message: "2 addresses are verified.",
    });
    const verified = await getNotifyAddress(db, SECOND);
    expect(verified?.verifiedAt).not.toBeNull();

    await hosting.notifyAddresses.remove(verified?.cfAddressId ?? "");
    await refreshNotifyAddresses(db, hosting, { now: NOW + 20 });
    expect(await getNotifyAddress(db, SECOND)).toMatchObject({ verifiedAt: null, cfAddressId: null });
  });
});

describe("pick for a domain", () => {
  test("sends a domain's offers to a verified address", async () => {
    const { db } = await setup();
    await insertNotifyAddress(db, { email: SECOND, verifiedAt: NOW, now: NOW });

    const result = await pickNotifyAddress(db, { host: HOST, email: SECOND, now: NOW + 1 });

    expect(result).toEqual({ ok: true, message: `Offers for ${HOST} go to ${SECOND}.` });
    expect((await getDomain(db, HOST))?.notifyEmail).toBe(SECOND);
  });

  test("refuses a pending or unknown address and an unknown domain, changing nothing", async () => {
    const { db } = await setup();
    await insertNotifyAddress(db, { email: SECOND, now: NOW });

    expect((await pickNotifyAddress(db, { host: HOST, email: SECOND, now: NOW })).ok).toBe(false);
    expect((await pickNotifyAddress(db, { host: HOST, email: "nobody@example.com", now: NOW })).ok).toBe(false);
    expect((await pickNotifyAddress(db, { host: "b.example", email: NOTIFY, now: NOW })).ok).toBe(false);
    expect((await getDomain(db, HOST))?.notifyEmail).toBe(NOTIFY);
  });
});

test("a wait reads in plain words", () => {
  expect(waitWords(NOW, 60_000, NOW + 59_000)).toBe("in a minute");
  expect(waitWords(NOW, 3_600_000, NOW + 20 * 60_000)).toBe("in about 40 minutes");
  expect(waitWords(NOW, 6 * 3_600_000, NOW + 60_000)).toBe("in about 6 hours");
});

describe("the address a domain without one gets", () => {
  const pending = (email: string, createdAt = NOW) => ({ email, verifiedAt: null, createdAt });
  const verified = (email: string, verifiedAt: number) => ({ email, verifiedAt, createdAt: NOW });

  test("the only address, even while it is pending", () => {
    expect(defaultNotifyAddress([pending(NOTIFY)])?.email).toBe(NOTIFY);
  });

  test("of several, the most recently verified", () => {
    expect(
      defaultNotifyAddress([verified(NOTIFY, NOW + 2), verified(SECOND, NOW + 5), pending("third@example.com")])?.email,
    ).toBe(SECOND);
  });

  test("none while there is none, or several and none verified", () => {
    expect(defaultNotifyAddress([])).toBeNull();
    expect(defaultNotifyAddress([pending(NOTIFY), pending(SECOND)])).toBeNull();
  });
});

describe("domains without an address get one", () => {
  async function bare() {
    const { db } = await createTestDb();
    await insertDomain(db, { domain: { host: HOST, zoneId: "zone-1", status: "live" }, now: NOW });
    return { db, hosting: createFakeHosting() };
  }

  test("adding the first address gives it to the domain at once, pending as it is", async () => {
    const { db, hosting } = await bare();
    await addNotifyAddress(db, hosting, { email: NOTIFY, now: NOW });
    expect((await getDomain(db, HOST))?.notifyEmail).toBe(NOTIFY);
  });

  test("with two pending addresses the first one verified is taken, as soon as it is", async () => {
    const { db, hosting } = await bare();
    for (const email of [NOTIFY, SECOND]) {
      await hosting.notifyAddresses.add(email);
      await insertNotifyAddress(db, { email, now: NOW });
    }
    expect(await fillMissingNotifyAddresses(db, NOW)).toEqual([]);
    hosting.verifyAddress(SECOND);
    await refreshNotifyAddresses(db, hosting, { now: NOW + 1 });
    expect((await getDomain(db, HOST))?.notifyEmail).toBe(SECOND);
  });

  test("a domain that has an address keeps it, and a removed one gets none", async () => {
    const { db } = await createTestDb();
    await seed(db);
    await insertNotifyAddress(db, { email: SECOND, verifiedAt: NOW + 9, now: NOW });
    await insertDomain(db, { domain: { host: "gone.example", zoneId: "zone-2", status: "removed" }, now: NOW });
    await insertDomain(db, { domain: { host: "new.example", zoneId: "zone-3" }, now: NOW });
    expect(await fillMissingNotifyAddresses(db, NOW)).toEqual(["new.example"]);
    expect((await getDomain(db, HOST))?.notifyEmail).toBe(NOTIFY);
    expect((await getDomain(db, "new.example"))?.notifyEmail).toBe(SECOND);
    expect((await getDomain(db, "gone.example"))?.notifyEmail).toBeNull();
  });

  test("removing a pending address in use moves its domains to the next default", async () => {
    const { db } = await setup();
    const hosting = createFakeHosting({ verifiedAddresses: [NOTIFY] });
    await insertNotifyAddress(db, { email: "typo@example.com", now: NOW });
    await updateDomain(db, { host: HOST, patch: { notifyEmail: "typo@example.com" }, now: NOW });

    const result = await removeNotifyAddress(db, hosting, { email: "typo@example.com", now: NOW });

    expect(result).toEqual({
      ok: true,
      message: `typo@example.com was removed. Offers for ${HOST} go to ${NOTIFY} now.`,
    });
    expect((await getDomain(db, HOST))?.notifyEmail).toBe(NOTIFY);
  });
});

describe("whether a domain's offers are emailed", () => {
  const addresses = [
    { email: NOTIFY, verifiedAt: NOW, createdAt: NOW },
    { email: SECOND, verifiedAt: null, createdAt: NOW },
  ];
  test("tells the four cases apart", () => {
    expect(offerMail(NOTIFY, addresses)).toEqual({ state: "ok", email: NOTIFY });
    expect(offerMail(SECOND, addresses)).toEqual({ state: "unverified", email: SECOND });
    expect(offerMail(null, addresses)).toEqual({ state: "unassigned" });
    expect(offerMail(null, [])).toEqual({ state: "no-address" });
  });
});
