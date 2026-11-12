import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { LOGS, ROOT, TMP } from "./paths";
import { type LocalWorker, startWorker } from "./processes";
import { startHostProxy } from "./proxy";
import { startReleaseServer } from "./release";

/** Obvious dummies. The mock accepts exactly this token; nothing here works against Cloudflare. */
export const TEST_TOKEN = "e2e-dummy-cloudflare-token";
export const TEST_ACCOUNT_ID = "e2e-account";
/** The workspace password `login()` arranges. */
export const TEST_PASSWORD = "e2e-dummy-password";
export const TEST_SESSION_KEY = "e2e-dummy-session-key-0123456789abcdef";
export const TURNSTILE_DUMMY_SITEKEY = "1x00000000000000000000AA";
/** The Worker secret every seeded Turnstile widget row should name in `turnstile_widgets.secret_name`. */
export const TURNSTILE_SECRET_NAME = "TURNSTILE_SECRET_1";
export const ZONES = [
  { id: "e2e-zone-example-com", name: "example.com" },
  { id: "e2e-zone-example-org", name: "example.org" },
];

const ADMIN_CONFIG = "apps/admin/dist/server/wrangler.json";
const SEED: MockSeed = { accountId: TEST_ACCOUNT_ID, accountName: "E2E account", token: TEST_TOKEN, zones: ZONES };

/** The version of the release the harness builds and the installer installs. */
export const TEST_RELEASE = "0.0.1-e2e";
/** A second release built from the same checkout, for updates: `setLatestRelease(TEST_RELEASE_NEXT)` offers it. */
export const TEST_RELEASE_NEXT = "0.0.2-e2e";

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
    /**
     * Serves the built releases (`/v<version>/<file>`), the newest as GitHub's API names it (`/latest`) and the
     * catalog files they name (`/files/catalog/…`).
     */
    release: string;
  };
  /** The SHA-256 of each built release's release.json, by version. */
  releases: Record<string, string>;
  /** What the admin finds as the newest release. None until a test sets one; `reset()` clears it. */
  setLatestRelease(version: string | null): void;
  /** `http://<host>.localhost:<port><path>`: the managed domain as a visitor's browser sees it, through the proxy. */
  hostUrl(host: string, path?: string): string;
  /** Puts a file into the sites Worker (`sites/example.com/index.html`) and waits until it is served. */
  writeSiteFile(path: string, body: string | Uint8Array): Promise<void>;
  /**
   * The emails the admin sent through its `send_email` binding since the last `reset()`, as raw MIME. Local workerd
   * writes each to a file and logs its path; the mock Cloudflare never sees them.
   */
  sentMail(): string[];
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
    // Filled in once the binding is open: the installer's database is the one the API reaches too.
    let attach = (_mock: MockCloudflare) => {};
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
    attach = (mock) => mock.attachDatabase("deparked", d1);
    attach(current);

    // A real release, built from this checkout, for the installer to download and verify.
    const releaseDir = resolve(dir, "release");
    const releaseServer = await startReleaseServer({ dir: releaseDir, files: resolve(ROOT, "apps/sites/public") });
    stops.push(() => releaseServer.close());
    const releases: Record<string, string> = {};
    for (const version of [TEST_RELEASE, TEST_RELEASE_NEXT]) {
      const out = resolve(releaseDir, version);
      execFileSync(
        process.execPath,
        ["scripts/build-release.ts", "--version", version, "--out", out, "--files-url", `${releaseServer.url}/files`],
        { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
      );
      releases[version] = readFileSync(resolve(out, "release.json.sha256"), "utf8").split(" ")[0] ?? "";
    }
    const releaseSha256 = releases[TEST_RELEASE] ?? "";
    const setLatestRelease = (version: string | null) =>
      releaseServer.setLatest(version === null ? null : { version, sha256: releases[version] ?? "" });

    cpSync(resolve(ROOT, "apps/sites/public"), assets, { recursive: true });
    const written = new Set<string>();

    const vars = { CLOUDFLARE_API_BASE: cloudflareApi, TURNSTILE_VERIFY_URL: siteverify };
    const adminVars = {
      ...vars,
      // What the installer stores for the admin: the release's `catalogFilesUrl`.
      RELEASE_FILES_URL: `${releaseServer.url}/files`,
      // Where Update looks for the newest release and downloads it: the release server, as GitHub.
      RELEASE_LATEST_URL: `${releaseServer.url}/latest`,
      RELEASE_DOWNLOAD_URL: releaseServer.url,
      SESSION_KEY: TEST_SESSION_KEY,
      CF_API_TOKEN: TEST_TOKEN,
      CF_ACCOUNT_ID: TEST_ACCOUNT_ID,
      [TURNSTILE_SECRET_NAME]: TURNSTILE_DUMMY_SECRET_PASS,
    };
    const started = await Promise.allSettled([
      startWorker({ name: "admin", config: ADMIN_CONFIG, persistTo, readyPath: "/admin", vars: adminVars }),
      // The same admin as a managed domain reaches it, behind the host proxy: it reads every request as https.
      startWorker({
        name: "admin-domains",
        config: ADMIN_CONFIG,
        persistTo,
        readyPath: "/admin",
        vars: adminVars,
        args: ["--upstream-protocol", "https"],
      }),
      startWorker({
        name: "install",
        config: "apps/install/wrangler.jsonc",
        persistTo,
        readyPath: "/health",
        vars: {
          ...vars,
          RELEASE_VERSION: TEST_RELEASE,
          RELEASE_SHA256: releaseSha256,
          RELEASE_BASE_URL: `${releaseServer.url}/v${TEST_RELEASE}`,
        },
      }),
      startWorker({
        name: "sites",
        config: "apps/sites/wrangler.jsonc",
        persistTo,
        readyPath: "/",
        args: ["--assets", assets],
      }),
    ]);
    for (const result of started) if (result.status === "fulfilled") stops.push(result.value.stop);
    const [admin, adminDomains, install, sites] = started.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    }) as [LocalWorker, LocalWorker, LocalWorker, LocalWorker];

    const proxy = await startHostProxy({ admin: adminDomains.url, sites: sites.url });
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

    const mailFiles = () =>
      ["admin", "admin-domains"].flatMap((name) => {
        const log = resolve(LOGS, `${name}.log`);
        return existsSync(log)
          ? [...readFileSync(log, "utf8").matchAll(/^Email: (\S+\.eml)$/gm)].map((m) => m[1] ?? "")
          : [];
      });
    let mailSeen = new Set<string>();

    return {
      mock,
      d1,
      releases,
      setLatestRelease,
      sentMail: () =>
        mailFiles()
          .filter((file) => !mailSeen.has(file))
          .map((file) => readFileSync(file, "utf8")),
      urls: {
        admin: admin.url,
        install: install.url,
        sites: sites.url,
        mock: server.url,
        cloudflareApi,
        siteverify,
        release: releaseServer.url,
      },
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
        setLatestRelease(null);
        mailSeen = new Set(mailFiles());
        current = createMockCloudflare(SEED);
        attach(current);
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
