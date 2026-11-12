import { getNotifyAddress, listNotifyAddresses, updateDomain } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { HostingError } from "@deparked/hosting";
import { createFakeHosting } from "@deparked/hosting/testing";
import { describe, expect, test } from "vitest";
import {
  addNotifyAddress,
  notifyEmailSchema,
  refreshNotifyAddresses,
  removeNotifyAddress,
  resendNotifyAddress,
} from "./notify";
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
    expect(row).toMatchObject({ email: SECOND, verifiedAt: null, createdAt: NOW });
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

  test("a host failure is reported and nothing is stored", async () => {
    const { db, hosting } = await setup();
    hosting.failNext("notifyAddresses", new HostingError("credentials-rejected", "Cloudflare refused the token."));

    const result = await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });

    expect(result).toEqual({ ok: false, message: "Cloudflare refused the token." });
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

    expect((await resendNotifyAddress(db, hosting, { email: SECOND, now: NOW + 1000 })).ok).toBe(true);
    const after = await getNotifyAddress(db, SECOND);
    expect(after?.cfAddressId).not.toBe(before?.cfAddressId);
    expect(after?.lastResentAt).toBe(NOW + 1000);

    expect((await resendNotifyAddress(db, hosting, { email: SECOND, now: NOW + 30_000 })).ok).toBe(false);
    expect((await resendNotifyAddress(db, hosting, { email: SECOND, now: NOW + 62_000 })).ok).toBe(true);
    expect(hosting.verificationMails).toEqual([SECOND, SECOND, SECOND]);
  });

  test("an address the host lost is added again", async () => {
    const { db, hosting } = await setup();
    await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });
    const row = await getNotifyAddress(db, SECOND);
    await hosting.notifyAddresses.remove(row?.cfAddressId ?? "");

    expect((await resendNotifyAddress(db, hosting, { email: SECOND, now: NOW + 1 })).ok).toBe(true);
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

    const result = await removeNotifyAddress(db, hosting, { email: NOTIFY });

    expect(result.ok).toBe(false);
    expect(result.message).toContain(HOST);
    expect(await getNotifyAddress(db, NOTIFY)).toBeDefined();
  });

  test("a pending address is deleted here and at the host", async () => {
    const { db, hosting } = await setup();
    await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });

    expect((await removeNotifyAddress(db, hosting, { email: SECOND })).ok).toBe(true);

    expect(await getNotifyAddress(db, SECOND)).toBeUndefined();
    expect((await hosting.notifyAddresses.list()).map((address) => address.email)).toEqual([NOTIFY]);
  });

  test("a verified address leaves the list but stays at the host", async () => {
    const { db, hosting } = await setup();
    await updateDomain(db, { host: HOST, patch: { notifyEmail: null }, now: NOW });

    const result = await removeNotifyAddress(db, hosting, { email: NOTIFY });

    expect(result.ok).toBe(true);
    expect(await getNotifyAddress(db, NOTIFY)).toBeUndefined();
    expect((await hosting.notifyAddresses.list()).map((address) => address.email)).toEqual([NOTIFY]);
  });

  test("a host failure keeps the address", async () => {
    const { db, hosting } = await setup();
    await addNotifyAddress(db, hosting, { email: SECOND, now: NOW });
    hosting.failNext("notifyAddresses", new HostingError("unavailable", "Cloudflare did not answer."));

    expect(await removeNotifyAddress(db, hosting, { email: SECOND })).toEqual({
      ok: false,
      message: "Cloudflare did not answer.",
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
