import { CONFIG_VERSION, defaultConfig, VARIANTS } from "@deparked/config";
import { type Db, insertDomain, publishConfig, saveDraft } from "@deparked/db";
import { createTestDb } from "@deparked/db/testing";
import { catalog } from "@deparked/templates/catalog";
import { beforeEach, describe, expect, it } from "vitest";
import { loadEditor, PREVIEW_SITEKEY, parseOrigin, renderPreview } from "./editor";

const HOST = "a.example";

describe("renderPreview", () => {
  const ORIGIN = "https://a.example";

  it("renders the posted draft with the domain filled in, inert and without a real sitekey", () => {
    const result = renderPreview({ catalog }, HOST, { ...defaultConfig(), headline: "Buy {domain} today" }, ORIGIN);
    if (!result.ok) throw new Error("expected a page");
    expect(result.html).toContain("Buy a.example today");
    expect(result.html).toMatch(/^<!doctype html><html[^>]*><head><meta http-equiv="Content-Security-Policy"/);
    expect(result.html).toContain(
      "default-src 'none'; img-src https://a.example data:; font-src https://a.example; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    );
    expect(result.html).toContain(PREVIEW_SITEKEY);
    expect(result.html).not.toContain("<base");
  });

  it("returns the field errors for an invalid draft", () => {
    const result = renderPreview({ catalog }, HOST, { ...defaultConfig(), headline: "", minOffer: -1 }, ORIGIN);
    expect(result).toEqual({
      ok: false,
      errors: { headline: "Add a headline.", minOffer: "The minimum offer can't be negative." },
    });
  });

  it("refuses something that is not a config", () => {
    expect(renderPreview({ catalog }, HOST, "<script>", ORIGIN)).toEqual({
      ok: false,
      errors: { form: "This config can't be read." },
    });
  });

  it("accepts only a bare http(s) origin for the policy", () => {
    expect(parseOrigin("https://a.example")).toBe("https://a.example");
    expect(parseOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(parseOrigin("https://a.example/")).toBeNull();
    expect(parseOrigin("https://a.example; script-src *")).toBeNull();
    expect(parseOrigin("javascript:alert(1)")).toBeNull();
  });
});

describe("loadEditor", () => {
  let db: Db;
  let time: number;
  const now = () => time;
  const json = (headline: string) => JSON.stringify({ ...defaultConfig(), headline });

  beforeEach(async () => {
    ({ db } = await createTestDb());
    time = 1_800_000_000_000;
    await insertDomain(db, { domain: { host: HOST, zoneId: "zone-a" }, now: time });
  });

  it("starts a never-edited domain from the defaults", async () => {
    const editor = await loadEditor({ db, catalog, now }, HOST);
    expect(editor).toMatchObject({ draft: defaultConfig(), draftStored: false, live: null, notice: null });
    expect(editor?.history).toEqual([]);
    expect(editor?.publish).toMatchObject({ draftDiffers: false, publishedAt: null, holder: null });
  });

  it("starts from the stored draft and lists what was published", async () => {
    await publishConfig(db, { host: HOST, json: json("Live"), schemaVersion: CONFIG_VERSION, release: null, now: 10 });
    await saveDraft(db, { host: HOST, json: json("Draft"), schemaVersion: CONFIG_VERSION, now: 20 });
    const editor = await loadEditor({ db, catalog, now }, HOST);
    expect(editor?.draft.headline).toBe("Draft");
    expect(editor?.draftStored).toBe(true);
    expect(editor?.live?.headline).toBe("Live");
    expect(editor?.history).toEqual([{ id: expect.any(Number), publishedAt: 10, variant: "sky", headline: "Live" }]);
    expect(editor?.publish.draftDiffers).toBe(true);
  });

  it("falls back to the live page and says so when the stored draft is unreadable", async () => {
    await publishConfig(db, { host: HOST, json: json("Live"), schemaVersion: CONFIG_VERSION, release: null, now: 10 });
    await saveDraft(db, { host: HOST, json: "{not json", schemaVersion: CONFIG_VERSION, now: 20 });
    const editor = await loadEditor({ db, catalog, now }, HOST);
    expect(editor?.draft.headline).toBe("Live");
    expect(editor?.draftStored).toBe(false);
    expect(editor?.notice).toContain("starts from the live page");
  });

  it("offers every variant of the schema and marks the ones this release renders", async () => {
    const editor = await loadEditor({ db, catalog, now }, HOST);
    expect(editor?.variants.map((variant) => variant.id)).toEqual([...VARIANTS]);
    expect(editor?.variants.find((variant) => variant.id === "sky")?.available).toBe(true);
    expect(editor?.backgrounds.map((background) => background.id)).toEqual([
      ...catalog.backgrounds.map((background) => background.id),
      ...catalog.gradients.map((gradient) => gradient.id),
    ]);
  });

  it("returns null for a host that is not managed", async () => {
    expect(await loadEditor({ db, catalog, now }, "b.example")).toBeNull();
  });
});
