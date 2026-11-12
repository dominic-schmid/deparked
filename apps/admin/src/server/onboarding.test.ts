import { insertDomain, insertNotifyAddress, setDomainStatus } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { describe, expect, test } from "vitest";
import { afterSetupPath, loadOnboarding, onboardingScreen } from "./onboarding";
import { NOW } from "./test-seed";

describe("which wizard screen shows", () => {
  test("an empty workspace starts at the notify address", () => {
    expect(onboardingScreen({ addressCount: 0, domainCount: 0, wantsDomainStep: false })).toBe("notify");
    // Skipping ahead in the URL does not skip the address.
    expect(onboardingScreen({ addressCount: 0, domainCount: 0, wantsDomainStep: true })).toBe("notify");
  });

  test("with an address, the inbox screen until the owner continues, then the domain", () => {
    expect(onboardingScreen({ addressCount: 1, domainCount: 0, wantsDomainStep: false })).toBe("inbox");
    expect(onboardingScreen({ addressCount: 1, domainCount: 0, wantsDomainStep: true })).toBe("domain");
  });

  test("any domain ends the wizard, with or without an address", () => {
    expect(onboardingScreen({ addressCount: 0, domainCount: 1, wantsDomainStep: false })).toBe("done");
    expect(onboardingScreen({ addressCount: 2, domainCount: 3, wantsDomainStep: true })).toBe("done");
  });
});

describe("where the new password lands", () => {
  test("the wizard only for an empty workspace", () => {
    expect(afterSetupPath({ addressCount: 0, domainCount: 0 })).toBe("/admin/welcome");
    // Recovery: a new password for a workspace that is already in use goes straight to the overview.
    expect(afterSetupPath({ addressCount: 1, domainCount: 0 })).toBe("/admin");
    expect(afterSetupPath({ addressCount: 0, domainCount: 1 })).toBe("/admin");
  });
});

describe("loadOnboarding", () => {
  test("counts a removed domain: the owner has been through setup before", async () => {
    const { db } = await createTestDb();
    expect(await loadOnboarding(db)).toEqual({ addresses: [], domainCount: 0 });

    await insertNotifyAddress(db, { email: "owner@example.com", now: NOW });
    await insertDomain(db, { domain: { host: "example.com", zoneId: "zone-1" }, now: NOW });
    await setDomainStatus(db, { host: "example.com", status: "removed", now: NOW });

    const loaded = await loadOnboarding(db);
    expect(loaded.domainCount).toBe(1);
    expect(loaded.addresses.map((address) => address.email)).toEqual(["owner@example.com"]);
  });
});
