import { describe, expect, it } from "vitest";
import { MAX_RELEASE_JSON_BYTES, parseRelease, readAtMost, releaseFromUrl, sha256Hex } from "./release";
import { buildFakeRelease, FAKE_FILES } from "./test-release";

const encoder = new TextEncoder();

async function withRelease(change: (release: Record<string, unknown>) => void) {
  const { release } = await buildFakeRelease();
  const copy = structuredClone(release) as unknown as Record<string, unknown>;
  change(copy);
  const bytes = encoder.encode(JSON.stringify(copy));
  return parseRelease(bytes, await sha256Hex(bytes));
}

describe("release.json", () => {
  it("accepts what the build writes", async () => {
    await expect(withRelease(() => {})).resolves.toMatchObject({ version: "1.0.0" });
  });

  it.each([
    ["a catalog file outside /catalog/", "catalog", "/sites/example.com/index.html"],
    ["a catalog path with ..", "catalog", "/catalog/../sites/x.html"],
    ["a module name with ..", "admin-modules", "../index.js"],
    ["a module name with a leading slash", "admin-modules", "/index.js"],
    ["an admin file outside /admin/", "admin-assets", "/catalog/x.js"],
    ["a migration that is not a plain file name", "migrations", "../0001.sql"],
  ])("refuses %s", async (_, pack, path) => {
    await expect(
      withRelease((release) => {
        const files = release.files as { pack: string; path: string }[];
        const file = files.find((entry) => entry.pack === pack);
        if (file !== undefined) file.path = path;
      }),
    ).rejects.toThrow("names a file Deparked refuses");
  });

  it("takes catalog files from https only, or plain http on this machine", async () => {
    const at = (url: string) =>
      withRelease((release) => {
        release.catalogFilesUrl = url;
      });
    await expect(at("http://files.example.com/release")).rejects.toThrow("cannot be read");
    await expect(at("http://127.0.0.1:8787/files")).resolves.toBeDefined();
  });
});

describe("downloads", () => {
  it("stops reading a body past its cap", async () => {
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
    });
    expect(await readAtMost(new Response(stream), 4096)).toBeNull();
    expect(await readAtMost(new Response("small"), 4096)).toEqual(encoder.encode("small"));
  });

  it("refuses a pack larger than release.json says, and an oversized release.json", async () => {
    const fake = await buildFakeRelease();
    const name = "deparked-1.0.0-catalog.pack";
    fake.assets.set(name, new Uint8Array([...(fake.assets.get(name) ?? []), 0]));
    const source = releaseFromUrl({ baseUrl: fake.baseUrl, pinnedSha256: fake.sha256, fetch: fake.fetch });
    await expect(source.pack("catalog")).rejects.toThrow("larger than release.json says");

    const huge = releaseFromUrl({
      baseUrl: fake.baseUrl,
      pinnedSha256: fake.sha256,
      fetch: async () => new Response(new Uint8Array(MAX_RELEASE_JSON_BYTES + 1)),
    });
    await expect(huge.manifest()).rejects.toThrow("larger than");
    expect(FAKE_FILES.length).toBeGreaterThan(0);
  });
});
