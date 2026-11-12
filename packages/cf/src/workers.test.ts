import { describe, expect, it } from "vitest";
import { type AssetManifest, CloudflareApiError, hashAsset } from "./index";
import { setup } from "./testing";

const SITES = "deparked-test-sites";
const ADMIN = "deparked-test-admin";
const encode = (text: string) => new TextEncoder().encode(text);

async function site(files: Record<string, string>) {
  const manifest: AssetManifest = {};
  for (const [path, body] of Object.entries(files)) {
    manifest[path] = { hash: await hashAsset(path, encode(body)), size: encode(body).length };
  }
  const reads: string[] = [];
  const read = async (path: string) => {
    reads.push(path);
    return { content: encode(files[path] ?? ""), contentType: "text/html" };
  };
  return { manifest, read, reads };
}

const FILES = {
  "/sites/a.example/index.html": "<h1>a.example is for sale</h1>",
  "/sites/b.example/index.html": "<h1>b.example is for sale</h1>",
  "/catalog/font.woff2": "font bytes",
};

describe("hashAsset", () => {
  it("matches the hash from Cloudflare's direct-upload example and depends on content and extension", async () => {
    const html = await hashAsset("/index.html", encode("hello"));
    expect(html).toBe("5deeda9d2277e0ed541bfc03adafb3cf");
    expect(await hashAsset("/other/index.html", encode("hello"))).toBe(html);
    expect(await hashAsset("/index.txt", encode("hello"))).not.toBe(html);
    expect(await hashAsset("/index.html", encode("hello!"))).not.toBe(html);
  });
});

describe("assets upload and deploy", () => {
  it("first upload sends every file, then deploys an assets-only Worker", async () => {
    const { mock, client } = setup({ bucketSize: 2 });
    const { manifest, read, reads } = await site(FILES);

    const upload = await client.workers.uploadAssets({ scriptName: SITES, manifest, read });
    expect(upload.uploaded.sort()).toEqual(Object.keys(FILES).sort());
    expect(reads).toHaveLength(3);
    expect(mock.callsTo("workers.assetsUpload")).toHaveLength(2);
    expect(mock.callsTo("workers.assetsUpload")[0]?.query).toEqual({ base64: "true" });
    expect(client.requestCount).toBe(3);

    await client.workers.uploadScript(SITES, {
      compatibilityDate: "2026-11-01",
      assets: { jwt: upload.completionJwt, config: { html_handling: "none" } },
    });
    const served = mock.deployedAssets(SITES);
    expect(new TextDecoder().decode(served.get("/sites/a.example/index.html")?.body)).toBe(
      "<h1>a.example is for sale</h1>",
    );
    expect(served.get("/sites/a.example/index.html")?.contentType).toBe("text/html");
    expect(mock.state.scripts.get(SITES)?.versions[0]?.metadata).toMatchObject({
      assets: { config: { html_handling: "none" } },
    });
    expect(mock.state.scripts.get(SITES)?.versions[0]?.metadata).not.toHaveProperty("main_module");
  });

  it("an unchanged re-upload has zero buckets: the session token is the completion token", async () => {
    const { mock, client } = setup();
    const { manifest, read, reads } = await site(FILES);
    await client.workers.uploadAssets({ scriptName: SITES, manifest, read });
    reads.length = 0;
    const before = client.requestCount;

    const session = await client.workers.createAssetsUploadSession(SITES, manifest);
    expect(session.buckets).toEqual([]);
    const again = await client.workers.uploadAssets({ scriptName: SITES, manifest, read });
    expect(again.uploaded).toEqual([]);
    expect(reads).toEqual([]);
    expect(mock.callsTo("workers.assetsUpload")).toHaveLength(1);
    expect(client.requestCount - before).toBe(2);

    await client.workers.uploadScript(SITES, { compatibilityDate: "2026-11-01", assets: { jwt: again.completionJwt } });
    expect(mock.deployedAssets(SITES).size).toBe(3);
  });

  it("one changed file: only that file is read and sent, the others stay served", async () => {
    const { mock, client } = setup();
    const first = await site(FILES);
    const done = await client.workers.uploadAssets({ scriptName: SITES, manifest: first.manifest, read: first.read });
    await client.workers.uploadScript(SITES, { compatibilityDate: "2026-11-01", assets: { jwt: done.completionJwt } });

    const changed = await site({ ...FILES, "/sites/a.example/index.html": "<h1>new price</h1>" });
    const upload = await client.workers.uploadAssets({
      scriptName: SITES,
      manifest: changed.manifest,
      read: changed.read,
    });
    expect(upload.uploaded).toEqual(["/sites/a.example/index.html"]);
    expect(changed.reads).toEqual(["/sites/a.example/index.html"]);

    await client.workers.uploadScript(SITES, {
      compatibilityDate: "2026-11-01",
      assets: { jwt: upload.completionJwt },
    });
    const served = mock.deployedAssets(SITES);
    const text = (path: string) => new TextDecoder().decode(served.get(path)?.body);
    expect(text("/sites/a.example/index.html")).toBe("<h1>new price</h1>");
    expect(text("/sites/b.example/index.html")).toBe("<h1>b.example is for sale</h1>");
  });

  it("uploads file bodies with the session token, never the API token", async () => {
    const { mock, client } = setup();
    const { manifest, read } = await site(FILES);
    const session = await client.workers.createAssetsUploadSession(SITES, manifest);

    const completion = await client.workers.uploadAssetsBucket(
      session.jwt,
      await Promise.all(
        Object.entries(manifest).map(async ([path, entry]) => ({ hash: entry.hash, ...(await read(path)) })),
      ),
    );
    expect(completion).toBeTypeOf("string");
    await expect(client.workers.uploadAssetsBucket("wrong-token", [])).rejects.toThrow(
      "upload assets failed: 401 Authentication error",
    );
    expect(mock.state.assets.size).toBe(3);
  });

  it("refuses to deploy with a session token that still waits for files", async () => {
    const { client } = setup();
    const { manifest } = await site(FILES);
    const session = await client.workers.createAssetsUploadSession(SITES, manifest);

    await expect(
      client.workers.uploadScript(SITES, { compatibilityDate: "2026-11-01", assets: { jwt: session.jwt } }),
    ).rejects.toThrow(`upload Worker ${SITES} failed: 400 assets.jwt is not a completion token`);
  });
});

describe("scripts, bindings and secrets", () => {
  const code = {
    mainModule: "index.js",
    modules: [{ name: "index.js", content: "export default { fetch() { return new Response('ok') } }" }],
    compatibilityDate: "2026-11-01",
  };

  it("uploads a Worker with D1, email, assets, text and secret bindings", async () => {
    const { mock, client } = setup();
    await client.workers.uploadScript(ADMIN, {
      ...code,
      compatibilityFlags: ["nodejs_compat"],
      bindings: [
        { type: "d1", name: "DB", databaseId: "db-1" },
        { type: "send_email", name: "EMAIL" },
        { type: "assets", name: "ASSETS" },
        { type: "plain_text", name: "RELEASE", text: "1.0.0" },
        { type: "secret_text", name: "CF_API_TOKEN", text: "a-secret" },
      ],
    });

    expect(mock.liveBindings(ADMIN)).toEqual([
      { type: "d1", name: "DB", id: "db-1", database_id: "db-1" },
      { type: "send_email", name: "EMAIL" },
      { type: "assets", name: "ASSETS" },
      { type: "plain_text", name: "RELEASE", text: "1.0.0" },
      { type: "secret_text", name: "CF_API_TOKEN", text: "a-secret" },
    ]);
    expect(await client.workers.getSettings(ADMIN)).toMatchObject({
      bindings: expect.arrayContaining([{ name: "CF_API_TOKEN", type: "secret_text" }]),
      compatibility_date: "2026-11-01",
    });
    expect(await client.workers.getSettings("deparked-test-missing")).toBeNull();
  });

  it("keeps secrets across a code update by default, and drops them when asked", async () => {
    const { mock, client } = setup();
    await client.workers.uploadScript(ADMIN, code);
    await client.workers.putSecret(ADMIN, "SESSION_KEY", "key-1");
    await client.workers.putSecret(ADMIN, "TURNSTILE_1", "ts-1");
    await client.workers.deleteSecret(ADMIN, "TURNSTILE_1");

    await client.workers.uploadScript(ADMIN, {
      ...code,
      bindings: [{ type: "plain_text", name: "RELEASE", text: "2" }],
    });
    expect(mock.liveBindings(ADMIN).map((binding) => binding.name)).toEqual(["RELEASE", "SESSION_KEY"]);

    await client.workers.uploadScript(ADMIN, { ...code, keepBindings: [] });
    expect(mock.liveBindings(ADMIN)).toEqual([]);
  });

  it("lists versions and deployments, and rolls back by deploying the previous version", async () => {
    const { client } = setup();
    await client.workers.uploadScript(ADMIN, code);
    const [first] = await client.workers.listVersions(ADMIN);
    if (first === undefined) throw new Error("no version");

    const next = await client.workers.uploadVersion(ADMIN, code);
    expect((await client.workers.listDeployments(ADMIN))[0]?.versions[0]?.version_id).toBe(first.id);

    await client.workers.deployVersion(ADMIN, next.id, "update to 2.0.0");
    expect((await client.workers.listDeployments(ADMIN))[0]?.versions).toEqual([
      { version_id: next.id, percentage: 100 },
    ]);

    await client.workers.deployVersion(ADMIN, first.id, "rollback");
    const deployments = await client.workers.listDeployments(ADMIN);
    expect(deployments).toHaveLength(3);
    expect(deployments[0]?.versions[0]?.version_id).toBe(first.id);
    expect((await client.workers.listVersions(ADMIN)).map((version) => version.id)).toEqual([next.id, first.id]);
  });

  it("cannot upload a version of a Worker that doesn't exist", async () => {
    const { client } = setup();
    const error = await client.workers.uploadVersion("deparked-test-missing", code).catch((caught) => caught);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect(error.status).toBe(404);
  });

  it("turns the workers.dev address on", async () => {
    const { mock, client } = setup();
    await client.workers.uploadScript(ADMIN, code);

    expect(await client.workers.setSubdomain(ADMIN, true)).toEqual({ enabled: true });
    expect(mock.state.scripts.get(ADMIN)?.subdomainEnabled).toBe(true);
  });
});
