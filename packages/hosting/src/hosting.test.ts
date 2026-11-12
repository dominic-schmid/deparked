import { describe, expect, it } from "vitest";
import { assertPublishFiles, contentHash, HostingError, notificationSender, type PublishFile } from "./index";
import { createFakeHosting } from "./testing";

const encode = (text: string) => new TextEncoder().encode(text);

async function manifest(pages: Record<string, string>) {
  const files: PublishFile[] = [];
  for (const [path, body] of Object.entries(pages)) {
    files.push({
      path,
      hash: await contentHash(path, encode(body)),
      size: encode(body).length,
      contentType: "text/html",
    });
  }
  const read: string[] = [];
  const getContent = async (path: string) => {
    read.push(path);
    return encode(pages[path] ?? "");
  };
  return { files, getContent, read };
}

describe("contentHash", () => {
  it("is 32 hex characters and depends on the content and the extension, not the folder", async () => {
    const hash = await contentHash("/sites/a.example/index.html", encode("hello"));
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(await contentHash("/sites/b.example/index.html", encode("hello"))).toBe(hash);
    expect(await contentHash("/sites/a.example/index.txt", encode("hello"))).not.toBe(hash);
    expect(await contentHash("/sites/a.example/index.html", encode("hello!"))).not.toBe(hash);
  });
});

describe("assertPublishFiles", () => {
  const file: PublishFile = { path: "/a.html", hash: "0".repeat(32), size: 1, contentType: "text/html" };

  it.each([
    ["an empty list", []],
    ["a path without a leading slash", [{ ...file, path: "a.html" }]],
    ["the same path twice", [file, file]],
    ["a hash of the wrong shape", [{ ...file, hash: "ABC" }]],
    ["a negative size", [{ ...file, size: -1 }]],
    ["no content type", [{ ...file, contentType: "" }]],
  ])("refuses %s", (_name, files) => {
    expect(() => assertPublishFiles(files)).toThrow(HostingError);
  });

  it("accepts a well-formed manifest", () => {
    expect(() => assertPublishFiles([file, { ...file, path: "/b.html" }])).not.toThrow();
  });
});

describe("HostingError", () => {
  it("flags rejected credentials and what is worth retrying", () => {
    expect(new HostingError("credentials-rejected", "no").credentialsRejected).toBe(true);
    expect(new HostingError("failed", "no").credentialsRejected).toBe(false);
    expect(new HostingError("unavailable", "no").retryable).toBe(true);
    expect(new HostingError("invalid-input", "no").retryable).toBe(false);
  });
});

it("offers come from offers@<senderHost>", () => {
  expect(notificationSender("example.com")).toBe("offers@example.com");
});

describe("createFakeHosting", () => {
  const PAGES = { "/sites/a.example/index.html": "a", "/sites/b.example/index.html": "b", "/catalog/x.css": "x" };

  it("fetches only content it has not seen, resumes a publish cut short, and rolls back", async () => {
    const hosting = createFakeHosting({ batchSize: 1 });
    const first = await manifest(PAGES);

    const partial = await hosting.publish({ ...first, maxUploadBatches: 2 });
    expect(partial).toMatchObject({ done: false, pending: 1 });
    expect(hosting.liveFiles()).toEqual([]);
    const done = await hosting.publish(first);
    expect(done.done && done.uploaded).toEqual(["/catalog/x.css"]);

    const changed = await manifest({ ...PAGES, "/sites/a.example/index.html": "new" });
    const second = await hosting.publish(changed);
    expect(changed.read).toEqual(["/sites/a.example/index.html"]);
    expect(hosting.liveFiles()).toEqual(changed.files);

    if (!done.done || !second.done) throw new Error("publish did not finish");
    await hosting.rollback(done.versionId);
    expect(hosting.liveFiles()).toEqual(first.files);
    expect(await hosting.listVersions()).toEqual([
      expect.objectContaining({ id: second.versionId, live: false }),
      expect.objectContaining({ id: done.versionId, live: true }),
    ]);
  });

  it("accepts a bot-check token once and only on its host", async () => {
    const hosting = createFakeHosting();
    hosting.acceptBotToken("t1", "example.com");
    hosting.acceptBotToken("t2", "other.example");
    const input = { host: "example.com", secretRef: "BOT_CHECK_SECRET_1" };
    expect(await hosting.verifyBotCheck({ ...input, token: "t1" })).toEqual({ ok: true });
    expect(await hosting.verifyBotCheck({ ...input, token: "t1" })).toEqual({ ok: false, reason: "rejected" });
    expect(await hosting.verifyBotCheck({ ...input, token: "t2" })).toEqual({ ok: false, reason: "wrong-host" });
  });

  it("sends notifications only to verified addresses", async () => {
    const hosting = createFakeHosting();
    const message = {
      senderHost: "example.com",
      to: "owner@example.com",
      replyTo: { email: "buyer@example.org" },
      subject: "Offer",
      text: "Hello",
    };
    const added = await hosting.notifyAddresses.add("owner@example.com");
    expect(added.verified).toBe(false);
    await expect(hosting.sendNotification(message)).rejects.toThrow(HostingError);
    const resent = await hosting.notifyAddresses.resend(added.id);
    expect(resent.id).not.toBe(added.id);
    expect(hosting.verificationMails).toEqual(["owner@example.com", "owner@example.com"]);

    hosting.verifyAddress("owner@example.com");
    await hosting.sendNotification(message);
    expect(hosting.sent).toEqual([message]);
    await hosting.notifyAddresses.remove(resent.id);
    expect(await hosting.notifyAddresses.list()).toEqual([]);
  });

  it("reports analytics from its rows and fails on demand", async () => {
    const hosting = createFakeHosting();
    hosting.analytics.push(
      { siteId: "s1", date: "2026-11-01", host: "a.example", referrer: "news.example", country: "AT", visits: 3 },
      { siteId: "s1", date: "2026-11-02", host: "a.example", referrer: "", country: "DE", visits: 5 },
      { siteId: "s2", date: "2026-11-02", host: "b.example", referrer: "", country: "DE", visits: 7 },
    );
    const query = { sites: [{ host: "a.example", siteId: "s1" }], from: "2026-11-01", to: "2026-11-30" };
    expect(await hosting.readAnalytics(query)).toEqual({
      visitsByDay: [
        { date: "2026-11-01", host: "a.example", visits: 3 },
        { date: "2026-11-02", host: "a.example", visits: 5 },
      ],
      referrers: [
        { host: "", visits: 5 },
        { host: "news.example", visits: 3 },
      ],
      countries: [
        { country: "DE", visits: 5 },
        { country: "AT", visits: 3 },
      ],
      totalVisits: 8,
    });

    hosting.rejectCredentials("readAnalytics");
    await expect(hosting.readAnalytics(query)).rejects.toMatchObject({ credentialsRejected: true });
    expect((await hosting.readAnalytics(query)).totalVisits).toBe(8);
  });

  it("never replaces a route something else owns", async () => {
    const hosting = createFakeHosting();
    hosting.seedForeignRoute("zone-1", "example.com/*");
    await expect(hosting.routes.add("zone-1", { pattern: "example.com/*", target: "sites" })).rejects.toMatchObject({
      code: "conflict",
    });
    const admin = await hosting.routes.add("zone-1", { pattern: "example.com/admin*", target: "admin" });
    expect(await hosting.routes.add("zone-1", { pattern: "example.com/admin*", target: "admin" })).toEqual(admin);
    await hosting.routes.remove("zone-1", admin.id);
    await expect(hosting.routes.remove("zone-1", admin.id)).rejects.toMatchObject({ code: "not-found" });
    const [foreign] = await hosting.routes.list("zone-1");
    await expect(hosting.routes.remove("zone-1", foreign?.id ?? "")).rejects.toMatchObject({ code: "conflict" });
    expect(await hosting.routes.list("zone-1")).toEqual([
      { id: expect.any(String), pattern: "example.com/*", target: "other" },
    ]);
  });
});
