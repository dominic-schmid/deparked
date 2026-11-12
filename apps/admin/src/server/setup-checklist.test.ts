import { insertDomain, insertNotifyAddress, publishConfig, saveDraft, setWorkspaceMark } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { describe, expect, test } from "vitest";
import { loadSetupChecklist, setupChecklist } from "./setup-checklist";
import { NOW } from "./test-seed";

const pending = (email: string, createdAt = NOW) => ({ email, verifiedAt: null, createdAt });
const verified = (email: string, createdAt = NOW) => ({ email, verifiedAt: createdAt + 1, createdAt });
const done = (checklist: ReturnType<typeof setupChecklist>) =>
  checklist?.steps.filter((step) => step.done).map((step) => step.id);

describe("the setup checklist", () => {
  test("an empty workspace has every step open", () => {
    expect(setupChecklist({ addresses: [], domains: [] })).toEqual({
      steps: [
        { id: "address", done: false },
        { id: "verify", done: false },
        { id: "domain", done: false },
        { id: "publish", done: false },
      ],
      email: null,
      host: null,
    });
  });

  test("a pending address is added but not verified, and the newest pending one is named", () => {
    const checklist = setupChecklist({
      addresses: [pending("old@example.com", NOW), pending("new@example.com", NOW + 5)],
      domains: [],
    });
    expect(done(checklist)).toEqual(["address"]);
    expect(checklist?.email).toBe("new@example.com");
  });

  test("a verified address wins over a newer pending one", () => {
    const checklist = setupChecklist({
      addresses: [verified("owner@example.com", NOW), pending("new@example.com", NOW + 5)],
      domains: [{ host: "example.com", publishedAt: null }],
    });
    expect(done(checklist)).toEqual(["address", "verify", "domain"]);
    expect(checklist?.email).toBe("owner@example.com");
    expect(checklist?.host).toBe("example.com");
  });

  test("the publish step points at the first domain without a published design", () => {
    const checklist = setupChecklist({
      addresses: [pending("owner@example.com")],
      domains: [
        { host: "a.example", publishedAt: NOW },
        { host: "b.example", publishedAt: null },
      ],
    });
    expect(done(checklist)).toEqual(["address", "domain", "publish"]);
    expect(checklist?.host).toBe("b.example");
  });

  test("goes away once every step is done", () => {
    expect(
      setupChecklist({
        addresses: [verified("owner@example.com")],
        domains: [{ host: "example.com", publishedAt: NOW }],
      }),
    ).toBeNull();
  });

  test("reads the database, and stays hidden once dismissed", async () => {
    const { db } = await createTestDb();
    await insertNotifyAddress(db, { email: "owner@example.com", now: NOW });
    await insertDomain(db, { domain: { host: "example.com", zoneId: "zone-1", status: "live" }, now: NOW });
    await saveDraft(db, { host: "example.com", json: "{}", schemaVersion: 1, now: NOW });
    expect(done(await loadSetupChecklist(db))).toEqual(["address", "domain"]);
    await publishConfig(db, { host: "example.com", json: "{}", schemaVersion: 1, release: "1.0.0", now: NOW });
    expect(done(await loadSetupChecklist(db))).toEqual(["address", "domain", "publish"]);
    await setWorkspaceMark(db, { mark: "setup-checklist-dismissed", now: NOW });
    expect(await loadSetupChecklist(db)).toBeNull();
  });
});
