import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createMockCloudflare,
  type MockCloudflare,
  type MockSeed,
  startMockCloudflare,
  TURNSTILE_DUMMY_SECRET_PASS,
} from "@deparked/cf/mock";
import { applyMigrations, d1Runner } from "@deparked/db";
import { getPlatformProxy } from "wrangler";
import { ROOT, TMP } from "./paths";
import { type LocalWorker, startWorker } from "./processes";
import { startHostProxy } from "./proxy";

/** Obvious dummies. The mock accepts exactly this token; nothing here works against Cloudflare. */
export const TEST_TOKEN = "e2e-dummy-cloudflare-token";
export const TEST_ACCOUNT_ID = "e2e-account";
export const TEST_SESSION_KEY = "e2e-dummy-session-key-0123456789abcdef";
export const TURNSTILE_DUMMY_SITEKEY = "1x00000000000000000000AA";
/** The Worker secret every seeded Turnstile widget row should name in `turnstile_widgets.secret_name`. */
export const TURNSTILE_SECRET_NAME = "TURNSTILE_SECRET_1";
export const ZONES = [
  { id: "e2e-zone-example-com", name: "example.com" },
  { id: "e2e-zone-example-org", name: "example.org" },
];

const SEED: MockSeed = { accountId: TEST_ACCOUNT_ID, accountName: "E2E account", token: TEST_TOKEN, zones: ZONES };

export interface Stack {
  /** Drives the mock Cloudflare the Workers talk to. A stable handle: it survives `reset()`. */
  mock: MockCloudflare;
  /** The local D1 database both the admin and the installer are bound to. */
  d1: D1Database;
  urls: {
    admin: string;
    install: string;
    sites: string;
    /** The mock's origin. */
    mock: string;
    /** `baseUrl` for `createCloudflareClient`. */
    cloudflareApi: string;
    siteverify: string;
  };
  /** `http://<host>.localhost:<port><path>`: the managed domain as a visitor's browser sees it, through the proxy. */
  hostUrl(host: string, path?: string): string;
  /** Puts a file into the sites Worker (`sites/example.com/index.html`) and waits until it is served. */
  writeSiteFile(path: string, body: string | Uint8Array): Promise<void>;
  /** A fresh mock with the seed, an empty database (schema kept) and no written site files. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export async function startStack(): Promise<Stack> {
  mkdirSync(TMP, { recursive: true });
  const dir = mkdtempSync(resolve(TMP, "run-"));
  const persistTo = resolve(dir, "state");
  const assets = resolve(dir, "sites-assets");
  const stops: (() => Promise<unknown>)[] = [() => Promise.resolve(rmSync(dir, { recursive: true, force: true }))];
  const stop = async () => {
    for (const step of stops.splice(0).reverse()) await step().catch(() => undefined);
  };

  try {
    let current = createMockCloudflare(SEED);
    const mock = new Proxy({} as MockCloudflare, { get: (_, key) => Reflect.get(current, key) });
    const server = await startMockCloudflare({ mock });
    stops.push(() => server.close());
    const cloudflareApi = `${server.url}/client/v4`;
    const siteverify = `${server.url}/turnstile/v0/siteverify`;

    // The same binding the Workers get, opened from Node: wrangler keys a local database by its binding and
    // the persist directory, so all three share one SQLite file.
    const platform = await getPlatformProxy<{ DB: D1Database }>({
      configPath: resolve(ROOT, "apps/install/wrangler.jsonc"),
      persist: { path: resolve(persistTo, "v3") },
    });
    stops.push(() => platform.dispose());
    const d1 = platform.env.DB;
    await applyMigrations(d1Runner(d1));

    cpSync(resolve(ROOT, "apps/sites/public"), assets, { recursive: true });
    const written = new Set<string>();

    const vars = { CLOUDFLARE_API_BASE: cloudflareApi, TURNSTILE_VERIFY_URL: siteverify };
    const started = await Promise.allSettled([
      startWorker({
        name: "admin",
        config: "apps/admin/dist/server/wrangler.json",
        persistTo,
        readyPath: "/admin",
        vars: {
          ...vars,
          SESSION_KEY: TEST_SESSION_KEY,
          CF_API_TOKEN: TEST_TOKEN,
          CF_ACCOUNT_ID: TEST_ACCOUNT_ID,
          [TURNSTILE_SECRET_NAME]: TURNSTILE_DUMMY_SECRET_PASS,
        },
      }),
      startWorker({ name: "install", config: "apps/install/wrangler.jsonc", persistTo, readyPath: "/health", vars }),
      startWorker({
        name: "sites",
        config: "apps/sites/wrangler.jsonc",
        persistTo,
        readyPath: "/",
        args: ["--assets", assets],
      }),
    ]);
    for (const result of started) if (result.status === "fulfilled") stops.push(result.value.stop);
    const [admin, install, sites] = started.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    }) as [LocalWorker, LocalWorker, LocalWorker];

    const proxy = await startHostProxy({ admin: admin.url, sites: sites.url });
    stops.push(() => proxy.close());

    /** Waits until the sites Worker has picked up a change to its assets directory. */
    const served = async (path: string, done: (response: Response) => boolean | Promise<boolean>) => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const response = await fetch(`${sites.url}/${path}`).catch(() => undefined);
        if (response !== undefined && (await done(response))) return;
        await new Promise((resolved) => setTimeout(resolved, 50));
      }
      throw new Error(`the sites Worker did not pick up the change to ${path} within 15 s`);
    };

    return {
      mock,
      d1,
      urls: { admin: admin.url, install: install.url, sites: sites.url, mock: server.url, cloudflareApi, siteverify },
      hostUrl: (host, path = "/") => `http://${host}.localhost:${proxy.port}${path}`,
      async writeSiteFile(path, body) {
        const file = resolve(assets, path);
        if (existsSync(file) && !written.has(path))
          throw new Error(`${path} ships with the sites Worker: write another path`);
        written.add(path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, body);
        const expected = Buffer.from(body);
        await served(
          path,
          async (response) => response.ok && expected.equals(Buffer.from(await response.arrayBuffer())),
        );
      },
      async reset() {
        current = createMockCloudflare(SEED);
        const tables = await d1
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
          )
          .all<{ name: string }>();
        if (tables.results.length > 0) {
          await d1.batch([
            d1.prepare("PRAGMA defer_foreign_keys = on"),
            ...tables.results.map(({ name }) => d1.prepare(`DELETE FROM "${name}"`)),
          ]);
        }
        const removed = [...written];
        written.clear();
        for (const path of removed) rmSync(resolve(assets, path), { force: true });
        for (const path of removed) await served(path, (response) => response.status === 404);
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
