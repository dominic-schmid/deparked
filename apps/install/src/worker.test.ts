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

    const status = await (await worker.fetch(new Request(`${ORIGIN}/api/status`), env)).json();
    expect(status).toMatchObject({
      phase: "installed",
      installedRelease: "1.0.0",
      adminUrl: "https://deparked-admin.owner.workers.dev/admin",
    });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
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
