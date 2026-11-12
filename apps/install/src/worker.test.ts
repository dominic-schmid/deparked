import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type MockCloudflareServer, startMockCloudflare } from "@deparked/cf/mock";
import { createDb, getWorkspace } from "@deparked/db";
import { createTestD1 } from "@deparked/db/testing";
import { sha256Hex } from "@deparked/provision";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFakeRelease } from "../../../packages/provision/src/test-release";
import type { CheckResponse, FinishResponse, StepResponse } from "./api";
import type { Env } from "./server/config";
import worker from "./worker";

const TOKEN = "test-token-never-shown-0123";
const ORIGIN = "https://deparked-install.owner.workers.dev";

let mock: MockCloudflareServer;
let releaseServer: Server;
let env: Env;
let d1: ReturnType<typeof createTestD1>;

beforeEach(async () => {
  mock = await startMockCloudflare({ token: TOKEN, workersSubdomain: "owner" });
  d1 = createTestD1();
  mock.mock.attachDatabase("deparked", d1.d1);
  const fake = await buildFakeRelease("1.0.0");
  releaseServer = createServer((request, response) => {
    const body = fake.assets.get((request.url ?? "").split("/").at(-1) ?? "");
    response.writeHead(body === undefined ? 404 : 200);
    response.end(body === undefined ? "" : Buffer.from(body));
  });
  await new Promise<void>((done) => releaseServer.listen(0, "127.0.0.1", done));
  const { port } = releaseServer.address() as AddressInfo;
  env = {
    DB: d1.d1,
    ASSETS: {
      fetch: async () => new Response("<!doctype html><title>Deparked installer</title>"),
    } as unknown as Fetcher,
    CLOUDFLARE_API_BASE: `${mock.url}/client/v4`,
    RELEASE_VERSION: "1.0.0",
    RELEASE_SHA256: fake.sha256,
    RELEASE_BASE_URL: `http://127.0.0.1:${port}/v1.0.0`,
  };
});

afterEach(async () => {
  await mock.close();
  await new Promise((done) => releaseServer.close(done));
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function call<T>(path: string, body: unknown): Promise<T> {
  return (await (await post(path, body)).json()) as T;
}

describe("the installer API", () => {
  it("connects, installs one step per request and hands over a setup link once", async () => {
    const checked = await call<CheckResponse>("/api/check", { token: TOKEN });
    expect(checked).toMatchObject({ ok: true, status: "ready", release: "1.0.0", missing: [], nothingToDo: false });
    if (!checked.ok || checked.status !== "ready") throw new Error("not ready");
    expect(checked.steps.map((entry) => entry.id)).toEqual(["download", "migrate", "sites", "admin"]);

    let next = 0;
    for (let request = 0; request < 10; request += 1) {
      const result = await call<StepResponse>("/api/step", { token: TOKEN, accountId: checked.account.id, next });
      if (!result.ok) throw new Error(result.message);
      expect(["ran", "already-done"]).toContain(result.report.outcome);
      next = result.report.next;
      if (result.report.finished) break;
    }
    expect(next).toBe(4);

    const finished = await call<FinishResponse>("/api/finish", { token: TOKEN, accountId: checked.account.id });
    if (!finished.ok) throw new Error(finished.message);
    expect(finished.adminUrl).toBe("https://deparked-admin.owner.workers.dev/admin");
    const secret = new URL(finished.setupUrl).searchParams.get("secret") ?? "";
    const workspace = await getWorkspace(createDb(d1.d1));
    expect(workspace?.setupSecretHash).toBe(await sha256Hex(new TextEncoder().encode(secret)));

    // Anyone may open the page: it learns that there is an install, nothing about it.
    const status = await (await worker.fetch(new Request(`${ORIGIN}/api/status`), env)).json();
    expect(status).toEqual({ phase: "installed", pinnedRelease: "1.0.0" });
    // No ownership proof is left behind.
    expect(await d1.d1.prepare("SELECT key FROM rate_limits WHERE key LIKE 'install-proof:%'").all()).toMatchObject({
      results: [],
    });
  });

  it("lets a stranger's token change nothing, and not disturb the owner's check running at the same time", async () => {
    // The stranger's own account, with its own database of the same name: a valid token, the wrong account.
    const stranger = await startMockCloudflare({ token: "strangers-token-0123456789", accountId: "stranger" });
    stranger.mock.addDatabase("deparked");
    const strangerEnv = { ...env, CLOUDFLARE_API_BASE: `${stranger.url}/client/v4` };
    const call2 = async <T>(target: Env, body: unknown) =>
      (await (
        await worker.fetch(
          new Request(`${ORIGIN}/api/check`, {
            method: "POST",
            headers: { origin: ORIGIN, "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          target,
        )
      ).json()) as T;
    try {
      await call<CheckResponse>("/api/check", { token: TOKEN });
      const tables = ["install_state", "workspace", "ledger", "site_files", "domains"];
      const snapshot = async () =>
        Promise.all(tables.map(async (table) => (await d1.d1.prepare(`SELECT * FROM ${table}`).all()).results));
      const before = await snapshot();

      const [foreign, owner] = await Promise.all([
        call2<CheckResponse>(strangerEnv, { token: "strangers-token-0123456789" }),
        call2<CheckResponse>(env, { token: TOKEN }),
      ]);
      expect(foreign).toMatchObject({ ok: false, error: "foreign-account" });
      expect(owner).toMatchObject({ ok: true, status: "ready" });

      const alone = await call2<CheckResponse>(strangerEnv, { token: "strangers-token-0123456789" });
      expect(alone).toMatchObject({ ok: false, error: "foreign-account" });
      expect(await snapshot()).toEqual(before);
      const proofs = await d1.d1.prepare("SELECT key FROM rate_limits WHERE key LIKE 'install-proof:%'").all();
      expect(proofs.results).toEqual([]);
      expect(mock.mock.state.scripts.size).toBe(0);
    } finally {
      await stranger.close();
    }
  });

  it("writes nothing but its throttle before the proof, on a database the Deploy button just made", async () => {
    mock.mock.state.databases = [];
    await call<CheckResponse>("/api/check", { token: TOKEN });
    const tables = await d1.d1.prepare("SELECT count(*) AS n FROM install_state").all();
    expect(tables.results).toEqual([{ n: 0 }]);
  });

  it("throttles proofs per address", async () => {
    let last: FinishResponse | undefined;
    for (let attempt = 0; attempt <= 60; attempt += 1) {
      last = await call<FinishResponse>("/api/finish", { token: TOKEN, accountId: mock.mock.state.accountId });
    }
    expect(last).toMatchObject({ ok: false, error: "busy" });
  });

  it("takes only the database with exactly the installer's name", async () => {
    const id = mock.mock.state.databases[0]?.uuid ?? "";
    mock.mock.state.databases = [{ uuid: id, name: "deparked-old" }];
    expect(await call<CheckResponse>("/api/check", { token: TOKEN })).toMatchObject({ error: "foreign-account" });
  });

  it("refuses a body over the cap even without a length header", async () => {
    const big = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ token: TOKEN, pad: "x".repeat(10_000) })));
        controller.close();
      },
    });
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/check`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: big,
        duplex: "half",
      } as RequestInit),
      env,
    );
    expect(response.status).toBe(400);
  });

  it("ignores a pinned version that is not a plain version", async () => {
    env = { ...env, RELEASE_VERSION: "1.0.0/../../evil" };
    expect(await call<CheckResponse>("/api/check", { token: TOKEN })).toMatchObject({ error: "no-release" });
  });

  it("names missing permissions in plain words and does not start", async () => {
    mock.mock.denyPermission("workers");
    mock.mock.denyPermission("turnstile");
    const checked = await call<CheckResponse>("/api/check", { token: TOKEN });
    if (!checked.ok || checked.status !== "ready") throw new Error("not ready");
    expect(checked.missing.map((entry) => entry.label)).toEqual(["Workers Scripts", "Turnstile"]);
    expect(checked.missing[0]?.why).toContain("installs");
    expect(checked.steps).toEqual([]);
    expect(mock.mock.state.scripts.size).toBe(0);
  });

  it("refuses a token of another account: it cannot read the installer's database", async () => {
    mock.mock.state.databases = [];
    const checked = await call<CheckResponse>("/api/check", { token: TOKEN });
    expect(checked).toMatchObject({ ok: false, error: "foreign-account" });
    const step = await call<StepResponse>("/api/step", { token: TOKEN, accountId: mock.mock.state.accountId, next: 0 });
    expect(step).toMatchObject({ ok: false, error: "foreign-account" });
    expect(mock.mock.state.scripts.size).toBe(0);
  });

  it("refuses a wrong token without echoing it", async () => {
    const wrong = "wrong-token-but-long-enough-1234";
    const response = await post("/api/check", { token: wrong });
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: "invalid-token" });
    expect(text).not.toContain(wrong);
  });

  it("asks which account when the token reaches several", async () => {
    mock.mock.state.otherAccounts = [{ id: "other-account", name: "Other" }];
    const checked = await call<CheckResponse>("/api/check", { token: TOKEN });
    expect(checked).toMatchObject({ ok: true, status: "pick-account" });
    const picked = await call<CheckResponse>("/api/check", { token: TOKEN, accountId: mock.mock.state.accountId });
    expect(picked).toMatchObject({ ok: true, status: "ready" });
  });

  it("rejects requests from another origin, without JSON, or with a token in the wrong shape", async () => {
    expect((await post("/api/check", { token: TOKEN }, { origin: "https://evil.example" })).status).toBe(403);
    const form = await worker.fetch(
      new Request(`${ORIGIN}/api/check`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
        body: `token=${TOKEN}`,
      }),
      env,
    );
    expect(form.status).toBe(415);
    expect((await post("/api/check", { token: "short" })).status).toBe(400);
    expect((await worker.fetch(new Request(`${ORIGIN}/api/check`), env)).status).toBe(405);
  });

  it("explains that there is nothing to install before the first release", async () => {
    const { RELEASE_VERSION: _, RELEASE_SHA256: __, ...unpinned } = env;
    env = unpinned;
    const checked = await call<CheckResponse>("/api/check", { token: TOKEN });
    expect(checked).toMatchObject({ ok: false, error: "no-release" });
  });

  it("serves health and the page", async () => {
    const health = await worker.fetch(new Request(`${ORIGIN}/health`), env);
    expect(await health.json()).toEqual({ ok: true, worker: "deparked-install" });
    const page = await worker.fetch(new Request(`${ORIGIN}/`), env);
    expect(await page.text()).toContain("Deparked installer");
  });
});
