// The hub: what one install creates once per account. The installer runs `planInstallHub` one step per request,
// then `issueSetupSecret`. `planUninstall` undoes every domain's ledger, then the hub's.
import { CloudflareApiError, type WorkerBinding } from "@deparked/cf";
import {
  applyMigrations,
  getInstallState,
  getWorkspace,
  initInstallState,
  initWorkspace,
  type LedgerEntry,
  listDomains,
  listSiteFiles,
  listSiteFilesByHost,
  listTurnstileWidgets,
  markLedgerUndone,
  replaceSiteFiles,
  type SqlRunner,
  setSetupSecret,
  toMigration,
  updateInstallState,
  updateWorkspace,
} from "@deparked/db";
import {
  activeLedger,
  createOnce,
  findEntry,
  INSTALLER_WORKER,
  intentKey,
  type ProvisionContext,
  workerNames,
} from "./context";
import { type Release, type ReleaseSource, sha256Hex } from "./release";
import { type Effect, type Plan, type Step, StepBlockedError, type StepCheck } from "./steps";
import { turnOffSteps } from "./turn-off";

export const DATABASE_NAME = "deparked";

/** How long a setup link works. Recovery makes a new one at any time. */
export const SETUP_SECRET_TTL_MS = 24 * 60 * 60 * 1000;

export interface HubOptions {
  release: ReleaseSource;
  /** The owner's API token. It goes to Cloudflare as the admin's `CF_API_TOKEN` secret and nowhere else. */
  token: string;
  /** The D1 database the installer is bound to. Default `deparked`. */
  databaseName?: string;
}

const needed = (effects: Effect[]): StepCheck => ({ status: "needed", effects });
const done = (effects: Effect[] = []): StepCheck => ({ status: "done", effects });
const blocked = (reason: string): StepCheck => ({ status: "blocked", reason });

function foreignWorker(name: string): string {
  return `A Worker named ${name} already exists in this account, and Deparked did not create it. Rename or delete it in Cloudflare (Workers & Pages), then retry.`;
}

export async function findDatabase(ctx: ProvisionContext, name: string): Promise<string | null> {
  // The API's name filter is a search: only the exact name is the installer's database.
  const database = (await ctx.cf.d1.list({ name })).find((entry) => entry.name === name);
  return database?.uuid ?? null;
}

function apiRunner(ctx: ProvisionContext, databaseId: string): SqlRunner {
  return async (statements) => {
    const results = await ctx.cf.d1.query(databaseId, statements.join(";\n"));
    return results.map((result) => result.results);
  };
}

function hubEntry(entries: readonly LedgerEntry[], name: string): LedgerEntry | undefined {
  return findEntry(entries, "worker", name) ?? entries.find((e) => e.resource === "worker" && intentKey(e) === name);
}

/**
 * Creates or replaces one of the hub's Workers. A Worker of that name that the ledger does not know is the owner's:
 * it is never overwritten. An announced create whose answer was lost adopts the Worker that is there.
 */
async function putWorker(ctx: ProvisionContext, name: string, upload: () => Promise<void>): Promise<void> {
  const entries = await activeLedger(ctx, null);
  const entry = hubEntry(entries, name);
  const exists = (await ctx.cf.workers.getSettings(name)) !== null;
  if (entry?.cfId != null) {
    await upload();
    return;
  }
  if (entry === undefined && exists) throw new StepBlockedError(foreignWorker(name));
  await createOnce(ctx, {
    entries,
    resource: "worker",
    key: name,
    lookAlikes: [],
    create: async () => {
      await upload();
      return name;
    },
  });
}

async function workerCheck(ctx: ProvisionContext, name: string): Promise<"owned" | "foreign" | "missing"> {
  const entry = hubEntry(await activeLedger(ctx, null), name);
  const exists = (await ctx.cf.workers.getSettings(name)) !== null;
  if (!exists) return "missing";
  return entry === undefined ? "foreign" : entry.cfId === null ? "missing" : "owned";
}

function downloadStep(options: HubOptions): Step {
  return {
    id: "download",
    title: "Download and check Deparked",
    async check(ctx) {
      const release = await options.release.manifest();
      const state = await getInstallState(ctx.db);
      if (state?.releaseVersion === release.version) return done();
      return needed([{ kind: "reuse", what: `Deparked ${release.version}, every file checked against its checksum` }]);
    },
    async run(ctx) {
      const release = await options.release.manifest();
      for (const pack of release.packs) await options.release.pack(pack.name);
      await initInstallState(ctx.db);
      await updateInstallState(ctx.db, { releaseVersion: release.version, step: "download", stepStatus: "done" });
      return {
        effects: [{ kind: "reuse", what: `Deparked ${release.version}: ${release.files.length} files checked` }],
      };
    },
  };
}

async function releaseMigrations(release: ReleaseSource) {
  const files = await release.pack("migrations");
  return files.map((file) => toMigration(file.path, new TextDecoder().decode(file.content)));
}

/** The names in `d1_migrations`, without creating it: a check only reads. */
async function appliedMigrations(run: SqlRunner): Promise<Set<unknown>> {
  const [tables = []] = await run([`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'`]);
  if (tables.length === 0) return new Set();
  const [rows = []] = await run([`SELECT name FROM "d1_migrations"`]);
  return new Set(rows.map((row) => row.name));
}

function databaseStep(options: HubOptions): Step {
  const name = options.databaseName ?? DATABASE_NAME;
  const missing = `The database ${name} is missing from this account. Deploy the installer again with the Deploy to Cloudflare button: it creates the database.`;
  return {
    id: "migrate",
    title: "Prepare the database",
    async check(ctx) {
      const release = await options.release.manifest();
      const id = await findDatabase(ctx, name);
      if (id === null) return blocked(missing);
      const applied = await appliedMigrations(apiRunner(ctx, id));
      const pending = release.files.filter((file) => file.pack === "migrations" && !applied.has(file.path));
      return pending.length === 0
        ? done()
        : needed(pending.map((file) => ({ kind: "change", what: `the database gets ${file.path}` })));
    },
    async run(ctx) {
      const id = await findDatabase(ctx, name);
      if (id === null) throw new StepBlockedError(missing);
      const result = await applyMigrations(apiRunner(ctx, id), await releaseMigrations(options.release));
      return { effects: result.applied.map((file) => ({ kind: "change", what: `the database got ${file}` })) };
    },
  };
}

function sitesStep(options: HubOptions): Step {
  return {
    id: "sites",
    title: "Upload the pages Worker",
    async check(ctx) {
      const { sites } = workerNames(ctx);
      const release = await options.release.manifest();
      const state = await workerCheck(ctx, sites);
      if (state === "foreign") return blocked(foreignWorker(sites));
      const rows = await listSiteFilesByHost(ctx.db, null);
      const catalog = release.files.filter((file) => file.pack === "catalog");
      const current =
        rows.length === catalog.length &&
        catalog.every((file) => rows.some((row) => row.path === file.path && row.hash === file.hash));
      if (state === "owned" && current) return done();
      return needed([
        {
          kind: state === "owned" ? "change" : "create",
          what: `the Worker ${sites}, which serves every domain's page (${catalog.length} shared design files)`,
        },
      ]);
    },
    async run(ctx) {
      const { sites } = workerNames(ctx);
      const release = await options.release.manifest();
      const catalog = await options.release.pack("catalog");
      const others = (await listSiteFiles(ctx.db)).filter((row) => row.host !== null);
      const manifest = Object.fromEntries([
        ...others.map((row) => [row.path, { hash: row.hash, size: row.size }] as const),
        ...catalog.map((file) => [file.path, { hash: file.hash, size: file.size }] as const),
      ]);
      const byPath = new Map(catalog.map((file) => [file.path, file]));
      await putWorker(ctx, sites, async () => {
        const { completionJwt } = await ctx.cf.workers.uploadAssets({
          scriptName: sites,
          manifest,
          read: async (path) => {
            const file = byPath.get(path);
            if (file === undefined) {
              throw new CloudflareApiError({
                call: "upload assets",
                status: 409,
                detail: `Cloudflare asked again for ${path}, a page the installer cannot rebuild. Publish that domain again from the admin.`,
              });
            }
            return { content: file.content, contentType: file.contentType };
          },
        });
        await ctx.cf.workers.uploadScript(sites, {
          compatibilityDate: release.workers.sites.compatibilityDate,
          assets: {
            jwt: completionJwt,
            config: { html_handling: "none", not_found_handling: "none", _headers: release.workers.sites.headers },
          },
        });
      });
      await replaceSiteFiles(ctx.db, {
        host: null,
        files: catalog.map(({ path, hash, size, contentType }) => ({ path, hash, size, contentType })),
        now: ctx.now(),
      });
      return { effects: [{ kind: "create", what: `the Worker ${sites} with ${catalog.length} shared design files` }] };
    },
  };
}

function randomSecret(bytes = 32): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function adminStep(options: HubOptions): Step {
  const name = options.databaseName ?? DATABASE_NAME;
  return {
    id: "admin",
    title: "Install the admin panel",
    async check(ctx) {
      const { admin } = workerNames(ctx);
      const release = await options.release.manifest();
      const state = await workerCheck(ctx, admin);
      if (state === "foreign") return blocked(foreignWorker(admin));
      if ((await ctx.cf.accounts.workersSubdomain()) === null) return blocked(NO_SUBDOMAIN);
      const workspace = await getWorkspace(ctx.db);
      if (state === "owned" && workspace?.installedRelease === release.version) return done();
      return needed([
        {
          kind: state === "owned" ? "change" : "create",
          what: `the Worker ${admin}: the admin panel, with the database, offer emails and your token as a secret`,
        },
      ]);
    },
    async run(ctx) {
      const { admin } = workerNames(ctx);
      const release = await options.release.manifest();
      const databaseId = await findDatabase(ctx, name);
      if (databaseId === null) throw new StepBlockedError(`The database ${name} is missing from this account.`);
      const modules = await options.release.pack("admin-modules");
      // The catalog too: the editor's preview loads it from the admin's own address (`img-src 'self'`).
      const assets = [...(await options.release.pack("admin-assets")), ...(await options.release.pack("catalog"))];
      const settings = await ctx.cf.workers.getSettings(admin);
      const hasSessionKey = settings?.bindings.some((binding) => binding.name === "SESSION_KEY") === true;
      const bindings: WorkerBinding[] = [
        { type: "d1", name: "DB", databaseId },
        { type: "send_email", name: "EMAIL" },
        { type: "plain_text", name: "CF_ACCOUNT_ID", text: ctx.cf.accountId },
        { type: "plain_text", name: "RELEASE_FILES_URL", text: release.catalogFilesUrl },
        { type: "secret_text", name: "CF_API_TOKEN", text: options.token },
        // Kept on a repeat: a new key would log the owner out everywhere.
        ...(hasSessionKey ? [] : [{ type: "secret_text" as const, name: "SESSION_KEY", text: randomSecret() }]),
      ];
      const byPath = new Map(assets.map((file) => [file.path, file]));
      await putWorker(ctx, admin, async () => {
        const { completionJwt } = await ctx.cf.workers.uploadAssets({
          scriptName: admin,
          manifest: Object.fromEntries(assets.map((file) => [file.path, { hash: file.hash, size: file.size }])),
          read: async (path) => {
            const file = byPath.get(path);
            if (file === undefined) throw new Error(`${path} is not an admin file`);
            return { content: file.content, contentType: file.contentType };
          },
        });
        await ctx.cf.workers.uploadScript(admin, {
          mainModule: release.workers.admin.mainModule,
          modules: modules.map((file) => ({ name: file.path, content: file.content, type: file.contentType })),
          compatibilityDate: release.workers.admin.compatibilityDate,
          compatibilityFlags: release.workers.admin.compatibilityFlags,
          bindings,
          assets: {
            jwt: completionJwt,
            ...(release.workers.admin.headers === undefined
              ? {}
              : { config: { _headers: release.workers.admin.headers } }),
          },
        });
      });
      await ctx.cf.workers.setSubdomain(admin, true);
      await initWorkspace(ctx.db, { cfAccountId: ctx.cf.accountId, now: ctx.now() });
      await updateWorkspace(ctx.db, {
        patch: { cfAccountId: ctx.cf.accountId, installedRelease: release.version },
        now: ctx.now(),
      });
      return { effects: [{ kind: "create", what: `the Worker ${admin}, reachable on its workers.dev address` }] };
    },
  };
}

const NO_SUBDOMAIN =
  "Your Cloudflare account has no workers.dev address yet. Open Workers & Pages in Cloudflare's dashboard once (it sets one up), then retry.";

/**
 * Download and check the release, migrate the database over the API, upload `deparked-sites` with the catalog
 * (recorded in `site_files` for the publish pipeline) and `deparked-admin` with its bindings and secrets. Every
 * Worker created is written to the ledger first; a Worker of the same name that Deparked did not create blocks.
 */
export function planInstallHub(ctx: ProvisionContext, options: HubOptions): Plan {
  return {
    kind: "install",
    host: null,
    ctx,
    steps: [downloadStep(options), databaseStep(options), sitesStep(options), adminStep(options)],
  };
}

/** The admin's address on workers.dev, or null when the account has no workers.dev subdomain. */
export async function adminUrl(ctx: ProvisionContext): Promise<string | null> {
  const subdomain = await ctx.cf.accounts.workersSubdomain();
  return subdomain === null ? null : `https://${workerNames(ctx).admin}.${subdomain}.workers.dev`;
}

/**
 * Makes a new one-time setup secret (the end of an install, and recovery). Only its SHA-256 is stored; the plain
 * value is returned once, for the setup link `/admin/setup?secret=…`. Any earlier secret stops working.
 */
export async function issueSetupSecret(ctx: ProvisionContext): Promise<string> {
  const secret = randomSecret();
  await initWorkspace(ctx.db, { cfAccountId: ctx.cf.accountId, now: ctx.now() });
  const stored = await setSetupSecret(ctx.db, {
    secretHash: await sha256Hex(new TextEncoder().encode(secret)),
    expiresAt: ctx.now() + SETUP_SECRET_TTL_MS,
    now: ctx.now(),
  });
  if (!stored) throw new Error("the workspace row is missing");
  return secret;
}

/** True once the admin of this release (or another) was installed. */
export async function hubInstalled(ctx: Pick<ProvisionContext, "db">): Promise<Release["version"] | null> {
  return (await getWorkspace(ctx.db))?.installedRelease ?? null;
}

/** What Uninstall leaves for the owner: Deparked never deletes what it did not create. */
export const UNINSTALL_LEAVES: readonly Effect[] = [
  {
    kind: "reuse",
    what: `the database ${DATABASE_NAME} with your offers: the admin needs it until its last step, so delete it yourself in Cloudflare (D1) after you exported your offers`,
  },
];

function removeHubStep(input: {
  id: string;
  title: string;
  match: (entry: LedgerEntry) => boolean;
  undo: (ctx: ProvisionContext, entry: LedgerEntry) => Promise<Effect>;
}): Step {
  const entries = async (ctx: ProvisionContext) => (await activeLedger(ctx, null)).filter(input.match);
  const describe = (entry: LedgerEntry): Effect => ({
    kind: "remove",
    what: `${entry.resource} ${entry.cfId ?? intentKey(entry) ?? ""}`.trim(),
  });
  return {
    id: input.id,
    title: input.title,
    async check(ctx) {
      const list = await entries(ctx);
      return list.length === 0 ? done() : needed(list.map(describe));
    },
    async run(ctx) {
      const effects: Effect[] = [];
      for (const entry of await entries(ctx)) {
        if (entry.cfId !== null) effects.push(await input.undo(ctx, entry));
        else
          effects.push({
            kind: "reuse",
            what: `${intentKey(entry) ?? entry.resource} may exist in Cloudflare: its create never answered. Look for it there.`,
          });
        await markLedgerUndone(ctx.db, { id: entry.id, now: ctx.now() });
      }
      return { effects };
    },
  };
}

const installer = (ctx: ProvisionContext) => workerNames(ctx).installer ?? INSTALLER_WORKER;

async function unlessGone(call: Promise<unknown>): Promise<void> {
  try {
    await call;
  } catch (error) {
    if (!(error instanceof CloudflareApiError && error.status === 404)) throw error;
  }
}

/**
 * Turns every domain off (its ledger, newest first), then deletes the hub's bot checks and Workers, the admin
 * last: run from the admin, its own deletion is the final call. Only what the ledger names is touched.
 */
export async function planUninstall(ctx: ProvisionContext): Promise<Plan> {
  const domains = await listDomains(ctx.db, { includeRemoved: true });
  const domainSteps = domains.flatMap((domain) =>
    turnOffSteps(domain.host).map((step) => ({
      ...step,
      id: `${domain.host}:${step.id}`,
      title: `${domain.host}: ${step.title}`,
    })),
  );
  const { sites, admin } = workerNames(ctx);
  const worker = (name: string) => (entry: LedgerEntry) =>
    entry.resource === "worker" && (entry.cfId ?? intentKey(entry)) === name;
  return {
    kind: "uninstall",
    host: null,
    ctx,
    steps: [
      ...domainSteps,
      removeHubStep({
        id: "remove-bot-checks",
        title: "Delete the bot checks",
        match: (entry) => entry.resource === "secret",
        async undo(ctx, entry) {
          const widget = (await listTurnstileWidgets(ctx.db)).find((row) => row.secretName === entry.cfId);
          if (widget !== undefined) await unlessGone(ctx.cf.turnstile.delete(widget.sitekey));
          return { kind: "remove", what: `the bot check ${widget?.name ?? entry.cfId}` };
        },
      }),
      removeHubStep({
        id: "remove-sites",
        title: "Delete the pages Worker",
        match: worker(sites),
        async undo(ctx) {
          await ctx.cf.workers.deleteScript(sites);
          return { kind: "remove", what: `the Worker ${sites} and every page on it` };
        },
      }),
      {
        id: "remove-installer",
        title: "Delete the installer",
        async check(ctx) {
          const name = installer(ctx);
          return (await ctx.cf.workers.getSettings(name)) === null
            ? done()
            : needed([{ kind: "remove", what: `the Worker ${name}, the installer the Deploy button created` }]);
        },
        async run(ctx) {
          const name = installer(ctx);
          await unlessGone(ctx.cf.workers.deleteScript(name));
          return { effects: [{ kind: "remove", what: `the Worker ${name}` }] };
        },
      },
      removeHubStep({
        id: "remove-admin",
        title: "Delete the admin panel",
        match: worker(admin),
        async undo(ctx) {
          await ctx.cf.workers.deleteScript(admin);
          return { kind: "remove", what: `the Worker ${admin}, with your token and its other secrets` };
        },
      }),
    ],
  };
}
