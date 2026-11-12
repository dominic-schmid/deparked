import { initWorkspace } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import type { HubSetup } from "@deparked/hosting";
import { describe, expect, it } from "vitest";
import { fetchLatestRelease, releaseLocation } from "./latest";
import { finishBlocker, LATEST_TTL_MS, newer, previewUpdate, refreshLatest, startUpdate } from "./updates";

const SHA = "ab".repeat(32);
const GITHUB = { latest: "https://api.github.com/repos/dominic-schmid/deparked/releases/latest", local: false };

function github(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    if (url.endsWith(".sha256")) return new Response(`${SHA}  release.json\n`);
    return Response.json(body, { status });
  };
  return { fetch, calls };
}

const release = (assets: unknown[]) => ({
  tag_name: "v1.2.0",
  html_url: "https://github.com/dominic-schmid/deparked/releases/tag/v1.2.0",
  assets,
});
const asset = (name: string, digest?: string | null) => ({
  name,
  browser_download_url: `https://github.com/dominic-schmid/deparked/releases/download/v1.2.0/${name}`,
  digest,
});

describe("the newest release", () => {
  it("takes the version from the tag and the hash from GitHub's digest of release.json", async () => {
    const { fetch, calls } = github(release([asset("release.json", `sha256:${SHA}`)]));
    expect(await fetchLatestRelease(GITHUB, fetch)).toEqual({
      ok: true,
      release: { version: "1.2.0", sha256: SHA, notesUrl: expect.stringContaining("v1.2.0") },
    });
    expect(calls).toHaveLength(1);
  });

  it("falls back to the release's release.json.sha256 when GitHub has no digest", async () => {
    const { fetch, calls } = github(release([asset("release.json", null), asset("release.json.sha256")]));
    expect(await fetchLatestRelease(GITHUB, fetch)).toMatchObject({
      ok: true,
      release: { sha256: SHA },
    });
    expect(calls).toHaveLength(2);
  });

  it("says so in plain words when there is no release, no checksum or no answer", async () => {
    expect(await fetchLatestRelease(GITHUB, github({}, 404).fetch)).toMatchObject({
      ok: false,
      message: expect.stringContaining("No Deparked release"),
    });
    expect(await fetchLatestRelease(GITHUB, github(release([asset("release.json")])).fetch)).toMatchObject({
      ok: false,
      message: expect.stringContaining("no checksum"),
    });
    expect(await fetchLatestRelease(GITHUB, github({ ...release([]), tag_name: "v1.2.0/../x" }).fetch)).toMatchObject({
      ok: false,
    });
    expect(
      await fetchLatestRelease(GITHUB, async () => {
        throw new TypeError("offline");
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("Could not reach GitHub") });
  });

  it("takes the checksum file only from GitHub's hosts, and refuses an oversized answer", async () => {
    const elsewhere = {
      ...asset("release.json.sha256"),
      browser_download_url: "https://evil.example.com/release.json.sha256",
    };
    const { fetch, calls } = github(release([asset("release.json", null), elsewhere]));
    expect(await fetchLatestRelease(GITHUB, fetch)).toMatchObject({ ok: false });
    expect(calls).toHaveLength(1);
    const huge = async () => new Response("x".repeat(2 * 1024 * 1024));
    expect(await fetchLatestRelease(GITHUB, huge)).toMatchObject({
      ok: false,
      message: expect.stringContaining("could not be read"),
    });
  });

  it("is looked up upstream; the variables only point at this machine", () => {
    expect(releaseLocation({}).latest).toBe("https://api.github.com/repos/dominic-schmid/deparked/releases/latest");
    expect(releaseLocation({}).releaseUrl("1.2.0")).toBe(
      "https://github.com/dominic-schmid/deparked/releases/download/v1.2.0",
    );
    const evil = {
      RELEASE_LATEST_URL: "https://evil.example.com/latest",
      RELEASE_DOWNLOAD_URL: "https://evil.example.com",
    };
    expect(releaseLocation(evil).latest).toContain("api.github.com");
    expect(releaseLocation(evil).releaseUrl("1.2.0")).toContain("github.com/dominic-schmid");
    const local = {
      RELEASE_LATEST_URL: "http://127.0.0.1:9000/latest",
      RELEASE_DOWNLOAD_URL: "http://127.0.0.1:9000/",
    };
    expect(releaseLocation(local).releaseUrl("1.2.0")).toBe("http://127.0.0.1:9000/v1.2.0");
  });

  it("compares versions as the installer does", () => {
    expect(newer("1.2.0", "1.1.9")).toBe(true);
    expect(newer("1.10.0", "1.9.0")).toBe(true);
    expect(newer("1.2.0", "1.2.0")).toBe(false);
    expect(newer("0.0.2-e2e", "0.0.1-e2e")).toBe(true);
    expect(newer("1.2.0", "1.2.0-rc.3")).toBe(true);
    expect(newer("1.2.0-rc.3", "1.2.0")).toBe(false);
    expect(newer("1.0.0", "1.2.0")).toBe(false);
  });
});

describe("checking and starting", () => {
  it("asks GitHub at most once an hour unless forced, and keeps the last answer when a look fails", async () => {
    const { db } = await createTestDb();
    await initWorkspace(db, { now: 0 });
    let asked = 0;
    const fetchLatest = async () => {
      asked += 1;
      return asked === 3
        ? { ok: false as const, message: "down" }
        : { ok: true as const, release: { version: "1.2.0", sha256: SHA, notesUrl: "https://x.test" } };
    };
    const first = await refreshLatest({ db, now: 1000, force: false, fetchLatest });
    expect(first.latest).toMatchObject({ version: "1.2.0", sha256: SHA, checkedAt: 1000 });
    await refreshLatest({ db, now: 1000 + LATEST_TTL_MS - 1, force: false, fetchLatest });
    expect(asked).toBe(1);
    await refreshLatest({ db, now: 2000, force: true, fetchLatest });
    expect(asked).toBe(2);
    const failed = await refreshLatest({ db, now: 3000, force: true, fetchLatest });
    expect(failed).toMatchObject({ checkError: "down", latest: { version: "1.2.0", checkedAt: 2000 } });
  });

  it("starts only the pin this admin found, never another one the browser sends", async () => {
    const { db } = await createTestDb();
    await initWorkspace(db, { now: 0 });
    await refreshLatest({
      db,
      now: 1,
      force: true,
      fetchLatest: async () => ({ ok: true, release: { version: "1.2.0", sha256: SHA, notesUrl: "u" } }),
    });
    const started: unknown[] = [];
    const hub = {
      startUpdate: async (pin: unknown) => {
        started.push(pin);
        return { ok: false as const, message: "stub" };
      },
    } as unknown as HubSetup;
    expect(await startUpdate({ db, hub, pin: { version: "1.2.0", sha256: "cd".repeat(32) } })).toMatchObject({
      ok: false,
      message: expect.stringContaining("changed since you looked"),
    });
    expect(await startUpdate({ db, hub, pin: { version: "1.3.0", sha256: SHA } })).toMatchObject({ ok: false });
    expect(started).toEqual([]);
    await startUpdate({ db, hub, pin: { version: "1.2.0", sha256: SHA } });
    expect(started).toEqual([{ version: "1.2.0", sha256: SHA }]);
  });

  it("finishes only once the new admin answers the request itself", () => {
    const change = { kind: "update" as const, pin: { version: "1.2.0", sha256: SHA }, startedAt: 100, finished: false };
    expect(finishBlocker(null, null)).toContain("No update");
    expect(finishBlocker(change, "1.1.0")).toContain("still runs 1.1.0");
    expect(finishBlocker(change, "1.2.0")).toBeNull();
    expect(finishBlocker(change, null)).toBeNull();
  });

  it("previews only the pin this admin found", async () => {
    const { db } = await createTestDb();
    await refreshLatest({
      db,
      now: 1,
      force: true,
      fetchLatest: async () => ({ ok: true, release: { version: "1.2.0", sha256: SHA, notesUrl: "u" } }),
    });
    const previewed: unknown[] = [];
    const hub = {
      previewUpdate: async (pin: unknown) => {
        previewed.push(pin);
        return { ok: false as const, message: "stub" };
      },
    } as unknown as HubSetup;
    expect(await previewUpdate({ db, hub, pin: { version: "1.2.1", sha256: SHA } })).toMatchObject({ ok: false });
    expect(previewed).toEqual([]);
    await previewUpdate({ db, hub, pin: { version: "1.2.0", sha256: SHA } });
    expect(previewed).toEqual([{ version: "1.2.0", sha256: SHA }]);
  });
});
