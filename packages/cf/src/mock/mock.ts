import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** Cloudflare's documented Turnstile test secrets. */
export const TURNSTILE_DUMMY_SECRET_PASS = "1x0000000000000000000000000000000AA";
export const TURNSTILE_DUMMY_SECRET_FAIL = "2x0000000000000000000000000000000AA";

export type MockPermission =
  | "workers"
  | "d1"
  | "turnstile"
  | "analytics"
  | "email_addresses"
  | "zones"
  | "routes"
  | "dns"
  | "rulesets"
  | "email_routing";

/** The part of a D1 binding `attachDatabase` uses. */
export interface MockD1 {
  prepare(sql: string): {
    bind(...values: unknown[]): { all(): Promise<{ results: unknown[] }> };
    all(): Promise<{ results: unknown[] }>;
  };
}

export interface MockZone {
  id: string;
  name: string;
}

export interface MockDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  priority?: number;
  proxied?: boolean;
  ttl?: number;
}

export interface MockRule {
  id: string;
  action: string;
  expression: string;
  description?: string;
  enabled: boolean;
  action_parameters?: unknown;
}

export interface MockRuleset {
  id: string;
  phase: string;
  rules: MockRule[];
}

export interface MockWidget {
  sitekey: string;
  secret: string;
  name: string;
  mode: string;
  domains: string[];
}

export interface MockAddress {
  id: string;
  email: string;
  verified: string | null;
}

export interface MockBinding {
  type: string;
  name: string;
  [key: string]: unknown;
}

export interface MockVersion {
  id: string;
  number: number;
  createdOn: string;
  metadata: Record<string, unknown>;
  bindings: MockBinding[];
  /** Module names; the mock doesn't keep module bodies. */
  modules: string[];
  manifest: Record<string, { hash: string; size: number }>;
}

export interface MockScript {
  name: string;
  versions: MockVersion[];
  deployments: { id: string; createdOn: string; versionId: string }[];
  subdomainEnabled: boolean;
}

export interface MockCall {
  /** The route id, for example `routes.create`. Undefined when no route matched. */
  route: string | undefined;
  method: string;
  path: string;
  query: Record<string, string>;
  /** Parsed JSON body, or the form's field names for a multipart body. */
  body: unknown;
}

export interface MockFailure {
  /** A route id (`routes.create`) or `*` for any call. */
  route: string;
  /** Fail the Nth matching call from now. Default 1 (the next one). */
  nth?: number;
  /** How many calls in a row fail, starting at the Nth. Default 1. */
  times?: number;
  status: number;
  code?: number;
  message?: string;
  retryAfterSeconds?: number;
  /** Apply the call's change first and then answer with the failure: the caller never learns it worked. */
  applyFirst?: boolean;
}

export interface MockSeed {
  accountId?: string;
  accountName?: string;
  token?: string;
  /** Which verify endpoint accepts the token. Default "user". */
  tokenKind?: "user" | "account";
  workersSubdomain?: string | null;
  zones?: MockZone[];
  dnsRecords?: Record<string, MockDnsRecord[]>;
  /** How many hashes the upload session puts in one bucket. Default 50. */
  bucketSize?: number;
}

export interface MockAnalyticsRow {
  siteTag: string;
  date: string;
  host: string;
  referrer: string;
  country: string;
  visits: number;
}

export interface MockState {
  accountId: string;
  accountName: string;
  /** Further accounts the token can see. API calls for them answer 404, like an account without access. */
  otherAccounts: { id: string; name: string }[];
  token: string;
  tokenKind: "user" | "account";
  workersSubdomain: string | null;
  zones: MockZone[];
  dnsRecords: Map<string, MockDnsRecord[]>;
  routes: Map<string, { id: string; pattern: string; script?: string }[]>;
  /** Keyed by `<zoneId>:<phase>`. */
  rulesets: Map<string, MockRuleset>;
  emailRouting: Map<string, boolean>;
  widgets: MockWidget[];
  addresses: MockAddress[];
  analyticsSites: { siteTag: string; siteToken: string; host: string }[];
  analytics: MockAnalyticsRow[];
  scripts: Map<string, MockScript>;
  /** Uploaded asset bodies by hash; what makes "only changed files are requested" work. */
  assets: Map<string, { contentType: string; base64: string }>;
  databases: { uuid: string; name: string }[];
  siteverify: { success: boolean; hostname: string };
}

class MockError extends Error {
  readonly status: number;
  readonly code: number;
  readonly retryAfterSeconds: number | undefined;
  constructor(status: number, code: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  json: Record<string, unknown>;
  form: FormData | undefined;
  bearer: string;
}

interface Reply {
  status?: number;
  result: unknown;
  paginate?: boolean;
}

interface Route {
  id: string;
  method: string;
  pattern: RegExp;
  permission?: MockPermission;
  /** The assets upload authenticates with the session token, the GraphQL and siteverify calls have no envelope. */
  auth?: "session" | "none";
  raw?: boolean;
  handle: (context: Context) => Reply | Promise<Reply>;
}

const MAX_WIDGET_HOSTNAMES = 10;

function compile(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
}

function notFound(what: string): MockError {
  return new MockError(404, 10007, `${what} not found`);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new MockError(400, 10021, `${field} is required`);
  return value;
}

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (const char of sql) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === ";") {
      statements.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  statements.push(current);
  return statements.map((statement) => statement.trim()).filter((statement) => statement !== "");
}

/**
 * An in-memory fake of the Cloudflare API surface `@deparked/cf` uses. Pass `mock.fetch` to the client in unit
 * tests, or serve it over HTTP with `startMockCloudflare`. State is plain data on `mock.state`: seed it and
 * assert on it directly.
 */
export function createMockCloudflare(seed: MockSeed = {}) {
  const state: MockState = {
    accountId: seed.accountId ?? "mock-account",
    accountName: seed.accountName ?? "Mock account",
    otherAccounts: [],
    token: seed.token ?? "mock-api-token",
    tokenKind: seed.tokenKind ?? "user",
    workersSubdomain: seed.workersSubdomain === undefined ? "mock" : seed.workersSubdomain,
    zones: [...(seed.zones ?? [])],
    dnsRecords: new Map(Object.entries(seed.dnsRecords ?? {})),
    routes: new Map(),
    rulesets: new Map(),
    emailRouting: new Map(),
    widgets: [],
    addresses: [],
    analyticsSites: [],
    analytics: [],
    scripts: new Map(),
    assets: new Map(),
    databases: [],
    siteverify: { success: true, hostname: "example.com" },
  };
  const bucketSize = seed.bucketSize ?? 50;
  const calls: MockCall[] = [];
  const failures: (Required<Pick<MockFailure, "route" | "status">> & MockFailure & { seen: number })[] = [];
  const denied = new Set<MockPermission>();
  const sqlite = new Map<string, DatabaseSync>();
  /** Databases served by a D1 binding instead of the mock's own SQLite: the API and the binding see one database. */
  const attached = new Map<string, MockD1>();
  /** Upload tokens: a session still waiting for files, or a completion token. */
  const uploads = new Map<string, { manifest: MockVersion["manifest"]; pending: Set<string>; complete: boolean }>();
  let counter = 0;

  function nextId(prefix: string): string {
    counter += 1;
    return `${prefix}-${counter}`;
  }

  function zone(context: Context): MockZone {
    const found = state.zones.find((entry) => entry.id === context.params.zone);
    if (found === undefined) throw notFound("zone");
    return found;
  }

  function script(context: Context): MockScript {
    const found = state.scripts.get(context.params.script ?? "");
    if (found === undefined) throw new MockError(404, 10007, "This Worker does not exist on your account.");
    return found;
  }

  function liveVersion(worker: MockScript): MockVersion | undefined {
    const versionId = worker.deployments.at(-1)?.versionId;
    return worker.versions.find((version) => version.id === versionId);
  }

  async function attachedSql(id: string, sql: string, params: SQLInputValue[]) {
    const d1 = attached.get(id);
    if (d1 === undefined) return undefined;
    const results = [];
    try {
      for (const statement of splitStatements(sql)) {
        const prepared = d1.prepare(statement);
        const { results: rows } = await (params.length === 0 ? prepared : prepared.bind(...params)).all();
        results.push({ success: true, results: rows, meta: {} });
      }
    } catch (error) {
      throw new MockError(400, 7500, error instanceof Error ? error.message : "SQL error");
    }
    return results;
  }

  function database(id: string): DatabaseSync {
    if (!state.databases.some((entry) => entry.uuid === id)) throw notFound("database");
    let db = sqlite.get(id);
    if (db === undefined) {
      db = new DatabaseSync(":memory:");
      sqlite.set(id, db);
    }
    return db;
  }

  function runSql(id: string, sql: string, params: SQLInputValue[]) {
    const db = database(id);
    try {
      return splitStatements(sql).map((statement) => {
        const prepared = db.prepare(statement);
        const results = prepared.all(...params);
        return { success: true, results, meta: {} };
      });
    } catch (error) {
      throw new MockError(400, 7500, error instanceof Error ? error.message : "SQL error");
    }
  }

  async function buildVersion(worker: MockScript, context: Context, withAssets: boolean): Promise<MockVersion> {
    const metadataPart = context.form?.get("metadata");
    if (metadataPart === null || metadataPart === undefined) throw new MockError(400, 10021, "metadata is required");
    const metadata = JSON.parse(typeof metadataPart === "string" ? metadataPart : await metadataPart.text()) as Record<
      string,
      unknown
    >;
    const previous = liveVersion(worker) ?? worker.versions.at(-1);
    const listed = (metadata.bindings ?? []) as MockBinding[];
    const keep = new Set((metadata.keep_bindings ?? []) as string[]);
    const kept = (previous?.bindings ?? []).filter(
      (binding) => keep.has(binding.type) && !listed.some((entry) => entry.name === binding.name),
    );
    const modules = [...(context.form?.keys() ?? [])].filter((name) => name !== "metadata");
    if (typeof metadata.main_module === "string" && !modules.includes(metadata.main_module)) {
      throw new MockError(400, 10021, `main module ${metadata.main_module} is missing from the upload`);
    }

    let manifest: MockVersion["manifest"] = {};
    const assets = metadata.assets as { jwt?: string } | undefined;
    if (withAssets && assets?.jwt !== undefined) {
      const upload = uploads.get(assets.jwt);
      if (upload === undefined || !upload.complete) {
        throw new MockError(400, 10021, "assets.jwt is not a completion token");
      }
      manifest = upload.manifest;
    } else if (withAssets && metadata.keep_assets === true) {
      manifest = previous?.manifest ?? {};
    }

    const version: MockVersion = {
      id: nextId("version"),
      number: worker.versions.length + 1,
      createdOn: new Date().toISOString(),
      metadata,
      bindings: [...listed, ...kept],
      modules,
      manifest,
    };
    worker.versions.push(version);
    return version;
  }
  function deploy(worker: MockScript, versionId: string) {
    const deployment = { id: nextId("deployment"), createdOn: new Date().toISOString(), versionId };
    worker.deployments.push(deployment);
    return deployment;
  }

  function deploymentJson(deployment: MockScript["deployments"][number]) {
    return {
      id: deployment.id,
      created_on: deployment.createdOn,
      source: "api",
      strategy: "percentage",
      versions: [{ version_id: deployment.versionId, percentage: 100 }],
    };
  }

  function versionJson(version: MockVersion) {
    return { id: version.id, number: version.number, metadata: { created_on: version.createdOn, source: "api" } };
  }

  function widgetJson(widget: MockWidget, withSecret: boolean) {
    const { secret, ...rest } = widget;
    return withSecret ? { ...rest, secret } : rest;
  }

  function checkHostnames(domains: unknown): string[] {
    if (!Array.isArray(domains)) throw new MockError(400, 10021, "domains is required");
    if (domains.length > MAX_WIDGET_HOSTNAMES) {
      throw new MockError(400, 10021, `too many domains (max: ${MAX_WIDGET_HOSTNAMES})`);
    }
    return domains as string[];
  }

  function ruleset(context: Context): MockRuleset {
    const found = [...state.rulesets.values()].find((entry) => entry.id === context.params.ruleset);
    if (found === undefined || !state.rulesets.has(`${context.params.zone}:${found.phase}`)) throw notFound("ruleset");
    return found;
  }

  function newRule(input: Record<string, unknown>): MockRule {
    return {
      id: nextId("rule"),
      action: text(input.action, "action"),
      expression: text(input.expression, "expression"),
      ...(typeof input.description === "string" ? { description: input.description } : {}),
      enabled: input.enabled !== false,
      ...(input.action_parameters === undefined ? {} : { action_parameters: input.action_parameters }),
    };
  }

  function routingJson(entry: MockZone) {
    const enabled = state.emailRouting.get(entry.id) === true;
    return { id: `routing-${entry.id}`, name: entry.name, enabled, status: enabled ? "ready" : "unconfigured" };
  }

  function verifyResult() {
    return { id: "mock-token-id", status: "active" };
  }

  function graphql(context: Context): Reply {
    const variables = (context.json.variables ?? {}) as { filter?: { AND?: Record<string, unknown>[] } };
    const filter = Object.assign({}, ...(variables.filter?.AND ?? [])) as {
      date_geq?: string;
      date_leq?: string;
      siteTag_in?: string[];
    };
    const rows = state.analytics.filter(
      (row) =>
        (filter.siteTag_in === undefined || filter.siteTag_in.includes(row.siteTag)) &&
        (filter.date_geq === undefined || row.date >= filter.date_geq) &&
        (filter.date_leq === undefined || row.date <= filter.date_leq),
    );
    const sum = (key: (row: MockAnalyticsRow) => string) => {
      const totals = new Map<string, number>();
      for (const row of rows) totals.set(key(row), (totals.get(key(row)) ?? 0) + row.visits);
      return [...totals].sort((a, b) => b[1] - a[1]);
    };
    const account = {
      visits: sum((row) => `${row.date}\n${row.host}`)
        .map(([key, visits]) => {
          const [date = "", requestHost = ""] = key.split("\n");
          return { sum: { visits }, dimensions: { date, requestHost } };
        })
        .sort((a, b) => a.dimensions.date.localeCompare(b.dimensions.date)),
      referrers: sum((row) => row.referrer).map(([refererHost, visits]) => ({
        sum: { visits },
        dimensions: { refererHost },
      })),
      countries: sum((row) => row.country).map(([countryName, visits]) => ({
        sum: { visits },
        dimensions: { countryName },
      })),
    };
    return { result: { data: { viewer: { accounts: [account] } }, errors: null } };
  }

  const account = "/accounts/:account";
  const worker = `${account}/workers/scripts/:script`;
  const routes: Route[] = (
    [
      {
        id: "tokens.verifyUser",
        method: "GET",
        pattern: "/user/tokens/verify",
        handle: () => {
          if (state.tokenKind !== "user") throw new MockError(401, 1000, "Invalid API Token");
          return { result: verifyResult() };
        },
      },
      {
        id: "tokens.verifyAccount",
        method: "GET",
        pattern: `${account}/tokens/verify`,
        handle: () => {
          if (state.tokenKind !== "account") throw new MockError(401, 1000, "Invalid API Token");
          return { result: verifyResult() };
        },
      },
      {
        id: "accounts.list",
        method: "GET",
        pattern: "/accounts",
        handle: () => ({
          result: [{ id: state.accountId, name: state.accountName, type: "standard" }, ...state.otherAccounts],
          paginate: true,
        }),
      },
      {
        id: "accounts.get",
        method: "GET",
        pattern: account,
        handle: () => ({ result: { id: state.accountId, name: state.accountName, type: "standard" } }),
      },
      {
        id: "accounts.workersSubdomain",
        method: "GET",
        pattern: `${account}/workers/subdomain`,
        permission: "workers",
        handle: () => {
          if (state.workersSubdomain === null) throw new MockError(404, 10007, "There is no workers.dev subdomain");
          return { result: { subdomain: state.workersSubdomain } };
        },
      },
      {
        id: "workers.listScripts",
        method: "GET",
        pattern: `${account}/workers/scripts`,
        permission: "workers",
        handle: () => ({ result: [...state.scripts.keys()].map((id) => ({ id })) }),
      },
      {
        id: "zones.list",
        method: "GET",
        pattern: "/zones",
        permission: "zones",
        handle: ({ query }) => {
          const name = query.get("name");
          const result = state.zones
            .filter((entry) => name === null || entry.name === name)
            .map((entry) => ({ ...entry, status: "active", account: { id: state.accountId } }));
          return { result, paginate: true };
        },
      },
      {
        id: "zones.get",
        method: "GET",
        pattern: "/zones/:zone",
        permission: "zones",
        handle: (context) => ({ result: { ...zone(context), status: "active", account: { id: state.accountId } } }),
      },
      {
        id: "dns.list",
        method: "GET",
        pattern: "/zones/:zone/dns_records",
        permission: "dns",
        handle: (context) => {
          const type = context.query.get("type");
          const name = context.query.get("name");
          const result = (state.dnsRecords.get(zone(context).id) ?? []).filter(
            (record) => (type === null || record.type === type) && (name === null || record.name === name),
          );
          return { result, paginate: true };
        },
      },
      {
        id: "dns.create",
        method: "POST",
        pattern: "/zones/:zone/dns_records",
        permission: "dns",
        handle: (context) => {
          const zoneId = zone(context).id;
          const record: MockDnsRecord = {
            id: nextId("dns"),
            type: text(context.json.type, "type"),
            name: text(context.json.name, "name"),
            content: text(context.json.content, "content"),
            ...(typeof context.json.priority === "number" ? { priority: context.json.priority } : {}),
            ...(typeof context.json.proxied === "boolean" ? { proxied: context.json.proxied } : {}),
            ...(typeof context.json.ttl === "number" ? { ttl: context.json.ttl } : {}),
          };
          const list = state.dnsRecords.get(zoneId) ?? [];
          if (
            list.some(
              (entry) => entry.type === record.type && entry.name === record.name && entry.content === record.content,
            )
          ) {
            throw new MockError(400, 81058, "An identical record already exists.");
          }
          state.dnsRecords.set(zoneId, [...list, record]);
          return { result: record };
        },
      },
      {
        id: "dns.delete",
        method: "DELETE",
        pattern: "/zones/:zone/dns_records/:record",
        permission: "dns",
        handle: (context) => {
          const zoneId = zone(context).id;
          const list = state.dnsRecords.get(zoneId) ?? [];
          if (!list.some((record) => record.id === context.params.record)) throw notFound("record");
          state.dnsRecords.set(
            zoneId,
            list.filter((record) => record.id !== context.params.record),
          );
          return { result: { id: context.params.record } };
        },
      },
      {
        id: "routes.list",
        method: "GET",
        pattern: "/zones/:zone/workers/routes",
        permission: "routes",
        handle: (context) => ({ result: state.routes.get(zone(context).id) ?? [] }),
      },
      {
        id: "routes.create",
        method: "POST",
        pattern: "/zones/:zone/workers/routes",
        permission: "routes",
        handle: (context) => {
          const zoneId = zone(context).id;
          const list = state.routes.get(zoneId) ?? [];
          const pattern = text(context.json.pattern, "pattern");
          if (list.some((route) => route.pattern === pattern)) {
            throw new MockError(409, 10020, "A route with the same pattern already exists.");
          }
          const route = { id: nextId("route"), pattern, script: text(context.json.script, "script") };
          state.routes.set(zoneId, [...list, route]);
          return { result: route };
        },
      },
      {
        id: "routes.update",
        method: "PUT",
        pattern: "/zones/:zone/workers/routes/:route",
        permission: "routes",
        handle: (context) => {
          const zoneId = zone(context).id;
          const list = state.routes.get(zoneId) ?? [];
          const found = list.find((route) => route.id === context.params.route);
          if (found === undefined) throw notFound("route");
          const pattern = text(context.json.pattern, "pattern");
          if (list.some((route) => route !== found && route.pattern === pattern)) {
            throw new MockError(409, 10020, "A route with the same pattern already exists.");
          }
          found.pattern = pattern;
          if (typeof context.json.script === "string") found.script = context.json.script;
          else delete found.script;
          return { result: found };
        },
      },
      {
        id: "routes.delete",
        method: "DELETE",
        pattern: "/zones/:zone/workers/routes/:route",
        permission: "routes",
        handle: (context) => {
          const zoneId = zone(context).id;
          const list = state.routes.get(zoneId) ?? [];
          if (!list.some((route) => route.id === context.params.route)) throw notFound("route");
          state.routes.set(
            zoneId,
            list.filter((route) => route.id !== context.params.route),
          );
          return { result: { id: context.params.route } };
        },
      },
      {
        id: "rulesets.getEntrypoint",
        method: "GET",
        pattern: "/zones/:zone/rulesets/phases/:phase/entrypoint",
        permission: "rulesets",
        handle: (context) => {
          const found = state.rulesets.get(`${zone(context).id}:${context.params.phase}`);
          if (found === undefined) throw new MockError(404, 10003, "could not find entrypoint ruleset in the phase");
          return { result: found };
        },
      },
      {
        id: "rulesets.create",
        method: "POST",
        pattern: "/zones/:zone/rulesets",
        permission: "rulesets",
        handle: (context) => {
          const phase = text(context.json.phase, "phase");
          const key = `${zone(context).id}:${phase}`;
          if (state.rulesets.has(key)) {
            throw new MockError(409, 20217, "a ruleset already exists for this phase");
          }
          const rules = ((context.json.rules ?? []) as Record<string, unknown>[]).map(newRule);
          const created = { id: nextId("ruleset"), phase, rules };
          state.rulesets.set(key, created);
          return { result: created };
        },
      },
      {
        id: "rulesets.addRule",
        method: "POST",
        pattern: "/zones/:zone/rulesets/:ruleset/rules",
        permission: "rulesets",
        handle: (context) => {
          const found = ruleset(context);
          found.rules.push(newRule(context.json));
          return { result: found };
        },
      },
      {
        id: "rulesets.deleteRule",
        method: "DELETE",
        pattern: "/zones/:zone/rulesets/:ruleset/rules/:rule",
        permission: "rulesets",
        handle: (context) => {
          const found = ruleset(context);
          if (!found.rules.some((rule) => rule.id === context.params.rule)) throw notFound("rule");
          found.rules = found.rules.filter((rule) => rule.id !== context.params.rule);
          return { result: found };
        },
      },
      {
        id: "workers.assetsUploadSession",
        method: "POST",
        pattern: `${worker}/assets-upload-session`,
        permission: "workers",
        handle: (context) => {
          const manifest = (context.json.manifest ?? {}) as MockVersion["manifest"];
          const missing = [...new Set(Object.values(manifest).map((entry) => entry.hash))].filter(
            (hash) => !state.assets.has(hash),
          );
          const buckets: string[][] = [];
          for (let index = 0; index < missing.length; index += bucketSize) {
            buckets.push(missing.slice(index, index + bucketSize));
          }
          const jwt = nextId("upload-token");
          uploads.set(jwt, { manifest, pending: new Set(missing), complete: missing.length === 0 });
          return { result: { jwt, buckets } };
        },
      },
      {
        id: "workers.assetsUpload",
        method: "POST",
        pattern: `${account}/workers/assets/upload`,
        auth: "session",
        handle: async (context) => {
          const session = uploads.get(context.bearer);
          if (session === undefined || session.complete) {
            throw new MockError(401, 10000, "Authentication error: not an upload session token");
          }
          if (context.query.get("base64") !== "true") throw new MockError(400, 10021, "base64 must be true");
          for (const [hash, part] of context.form ?? []) {
            if (!session.pending.has(hash)) throw new MockError(400, 10021, `unexpected file ${hash}`);
            const contentType = typeof part === "string" ? "application/octet-stream" : part.type;
            state.assets.set(hash, { contentType, base64: typeof part === "string" ? part : await part.text() });
            session.pending.delete(hash);
          }
          if (session.pending.size > 0) return { status: 202, result: {} };
          const jwt = nextId("completion-token");
          uploads.set(jwt, { manifest: session.manifest, pending: new Set(), complete: true });
          uploads.delete(context.bearer);
          return { status: 201, result: { jwt } };
        },
      },
      {
        id: "workers.uploadScript",
        method: "PUT",
        pattern: worker,
        permission: "workers",
        handle: async (context) => {
          const name = context.params.script ?? "";
          const existing = state.scripts.get(name) ?? { name, versions: [], deployments: [], subdomainEnabled: false };
          const version = await buildVersion(existing, context, true);
          state.scripts.set(name, existing);
          deploy(existing, version.id);
          return {
            result: { id: name, etag: version.id, has_assets: Object.keys(version.manifest).length > 0 },
          };
        },
      },
      {
        id: "workers.uploadVersion",
        method: "POST",
        pattern: `${worker}/versions`,
        permission: "workers",
        handle: async (context) => {
          const found = script(context);
          const version = await buildVersion(found, context, false);
          version.manifest = liveVersion(found)?.manifest ?? {};
          return { result: versionJson(version) };
        },
      },
      {
        id: "workers.listVersions",
        method: "GET",
        pattern: `${worker}/versions`,
        permission: "workers",
        handle: (context) => ({ result: { items: script(context).versions.map(versionJson).reverse() } }),
      },
      {
        id: "workers.listDeployments",
        method: "GET",
        pattern: `${worker}/deployments`,
        permission: "workers",
        handle: (context) => ({ result: { deployments: script(context).deployments.map(deploymentJson).reverse() } }),
      },
      {
        id: "workers.deploy",
        method: "POST",
        pattern: `${worker}/deployments`,
        permission: "workers",
        handle: (context) => {
          const found = script(context);
          const versions = (context.json.versions ?? []) as { version_id?: string }[];
          const versionId = versions[0]?.version_id;
          if (!found.versions.some((version) => version.id === versionId) || versionId === undefined) {
            throw notFound("version");
          }
          return { result: deploymentJson(deploy(found, versionId)) };
        },
      },
      {
        id: "workers.putSecret",
        method: "PUT",
        pattern: `${worker}/secrets`,
        permission: "workers",
        handle: (context) => {
          const version = liveVersion(script(context));
          const name = text(context.json.name, "name");
          if (version === undefined) throw notFound("version");
          version.bindings = [
            ...version.bindings.filter((binding) => binding.name !== name),
            { type: "secret_text", name, text: text(context.json.text, "text") },
          ];
          return { result: { name, type: "secret_text" } };
        },
      },
      {
        id: "workers.deleteSecret",
        method: "DELETE",
        pattern: `${worker}/secrets/:secret`,
        permission: "workers",
        handle: (context) => {
          const version = liveVersion(script(context));
          const before = version?.bindings.length ?? 0;
          if (version !== undefined) {
            version.bindings = version.bindings.filter(
              (binding) => !(binding.type === "secret_text" && binding.name === context.params.secret),
            );
          }
          if (version === undefined || version.bindings.length === before) throw notFound("secret");
          return { result: null };
        },
      },
      {
        id: "workers.setSubdomain",
        method: "POST",
        pattern: `${worker}/subdomain`,
        permission: "workers",
        handle: (context) => {
          const found = script(context);
          found.subdomainEnabled = context.json.enabled === true;
          return { result: { enabled: found.subdomainEnabled, previews_enabled: false } };
        },
      },
      {
        id: "workers.deleteScript",
        method: "DELETE",
        pattern: worker,
        permission: "workers",
        handle: (context) => {
          const found = script(context);
          state.scripts.delete(found.name);
          return { result: null };
        },
      },
      {
        id: "workers.getSettings",
        method: "GET",
        pattern: `${worker}/settings`,
        permission: "workers",
        handle: (context) => {
          const version = liveVersion(script(context));
          return {
            result: {
              bindings: (version?.bindings ?? []).map((binding) => ({ name: binding.name, type: binding.type })),
              compatibility_date: version?.metadata.compatibility_date,
            },
          };
        },
      },
      {
        id: "d1.list",
        method: "GET",
        pattern: `${account}/d1/database`,
        permission: "d1",
        handle: ({ query }) => {
          const name = query.get("name");
          return { result: state.databases.filter((entry) => name === null || entry.name === name), paginate: true };
        },
      },
      {
        id: "d1.create",
        method: "POST",
        pattern: `${account}/d1/database`,
        permission: "d1",
        handle: (context) => {
          const name = text(context.json.name, "name");
          if (state.databases.some((entry) => entry.name === name)) {
            throw new MockError(400, 7502, `database with name '${name}' already exists`);
          }
          const created = { uuid: nextId("d1"), name };
          state.databases.push(created);
          return { result: created };
        },
      },
      {
        id: "d1.query",
        method: "POST",
        pattern: `${account}/d1/database/:database/query`,
        permission: "d1",
        handle: async (context) => {
          const id = context.params.database ?? "";
          const sql = text(context.json.sql, "sql");
          const params = (context.json.params ?? []) as SQLInputValue[];
          return { result: (await attachedSql(id, sql, params)) ?? runSql(id, sql, params) };
        },
      },
      {
        id: "turnstile.list",
        method: "GET",
        pattern: `${account}/challenges/widgets`,
        permission: "turnstile",
        handle: () => ({ result: state.widgets.map((widget) => widgetJson(widget, false)), paginate: true }),
      },
      {
        id: "turnstile.create",
        method: "POST",
        pattern: `${account}/challenges/widgets`,
        permission: "turnstile",
        handle: (context) => {
          const widget: MockWidget = {
            sitekey: nextId("0x4AAAAAAAmock"),
            secret: nextId("0x4AAAAAAAmock-secret"),
            name: text(context.json.name, "name"),
            mode: text(context.json.mode, "mode"),
            domains: checkHostnames(context.json.domains),
          };
          state.widgets.push(widget);
          return { result: widgetJson(widget, true) };
        },
      },
      {
        id: "turnstile.get",
        method: "GET",
        pattern: `${account}/challenges/widgets/:sitekey`,
        permission: "turnstile",
        handle: (context) => ({ result: widgetJson(widget(context), true) }),
      },
      {
        id: "turnstile.update",
        method: "PUT",
        pattern: `${account}/challenges/widgets/:sitekey`,
        permission: "turnstile",
        handle: (context) => {
          const found = widget(context);
          const domains = checkHostnames(context.json.domains);
          found.name = text(context.json.name, "name");
          found.mode = text(context.json.mode, "mode");
          found.domains = domains;
          return { result: widgetJson(found, true) };
        },
      },
      {
        id: "turnstile.delete",
        method: "DELETE",
        pattern: `${account}/challenges/widgets/:sitekey`,
        permission: "turnstile",
        handle: (context) => {
          const found = widget(context);
          state.widgets = state.widgets.filter((entry) => entry !== found);
          return { result: widgetJson(found, true) };
        },
      },
      {
        id: "analytics.listSites",
        method: "GET",
        pattern: `${account}/rum/site_info/list`,
        permission: "analytics",
        handle: () => ({ result: state.analyticsSites.map(siteJson), paginate: true }),
      },
      {
        id: "analytics.createSite",
        method: "POST",
        pattern: `${account}/rum/site_info`,
        permission: "analytics",
        handle: (context) => {
          const site = {
            siteTag: nextId("site-tag"),
            siteToken: nextId("site-token"),
            host: text(context.json.host, "host"),
          };
          state.analyticsSites.push(site);
          return { result: siteJson(site) };
        },
      },
      {
        id: "analytics.deleteSite",
        method: "DELETE",
        pattern: `${account}/rum/site_info/:site`,
        permission: "analytics",
        handle: (context) => {
          if (!state.analyticsSites.some((site) => site.siteTag === context.params.site)) throw notFound("site");
          state.analyticsSites = state.analyticsSites.filter((site) => site.siteTag !== context.params.site);
          return { result: { site_tag: context.params.site } };
        },
      },
      {
        id: "analytics.graphql",
        method: "POST",
        pattern: "/graphql",
        permission: "analytics",
        raw: true,
        handle: graphql,
      },
      {
        id: "email.listAddresses",
        method: "GET",
        pattern: `${account}/email/routing/addresses`,
        permission: "email_addresses",
        handle: () => ({ result: state.addresses, paginate: true }),
      },
      {
        id: "email.createAddress",
        method: "POST",
        pattern: `${account}/email/routing/addresses`,
        permission: "email_addresses",
        handle: (context) => {
          const email = text(context.json.email, "email");
          if (state.addresses.some((address) => address.email === email)) {
            throw new MockError(409, 2032, "destination address already exists");
          }
          const address = { id: nextId("address"), email, verified: null };
          state.addresses.push(address);
          return { result: address };
        },
      },
      {
        id: "email.deleteAddress",
        method: "DELETE",
        pattern: `${account}/email/routing/addresses/:address`,
        permission: "email_addresses",
        handle: (context) => {
          const found = state.addresses.find((address) => address.id === context.params.address);
          if (found === undefined) throw notFound("address");
          state.addresses = state.addresses.filter((address) => address !== found);
          return { result: found };
        },
      },
      {
        id: "email.getRouting",
        method: "GET",
        pattern: "/zones/:zone/email/routing",
        permission: "email_routing",
        handle: (context) => ({ result: routingJson(zone(context)) }),
      },
      {
        id: "email.enableRouting",
        method: "POST",
        pattern: "/zones/:zone/email/routing/enable",
        permission: "email_routing",
        handle: (context) => {
          const found = zone(context);
          state.emailRouting.set(found.id, true);
          state.dnsRecords.set(found.id, [
            ...(state.dnsRecords.get(found.id) ?? []).filter(
              (record) => !(record.type === "MX" && record.name === found.name),
            ),
            { id: nextId("dns"), type: "MX", name: found.name, content: "route1.mx.cloudflare.net", priority: 10 },
          ]);
          return { result: routingJson(found) };
        },
      },
      {
        id: "email.disableRouting",
        method: "POST",
        pattern: "/zones/:zone/email/routing/disable",
        permission: "email_routing",
        handle: (context) => {
          const found = zone(context);
          state.emailRouting.set(found.id, false);
          state.dnsRecords.set(
            found.id,
            (state.dnsRecords.get(found.id) ?? []).filter(
              (record) => !(record.type === "MX" && record.content.endsWith(".mx.cloudflare.net")),
            ),
          );
          return { result: routingJson(found) };
        },
      },
      {
        id: "turnstile.siteverify",
        method: "POST",
        pattern: "/turnstile/v0/siteverify",
        auth: "none",
        raw: true,
        handle: (context) => {
          const secret = context.json.secret;
          const known =
            secret === TURNSTILE_DUMMY_SECRET_PASS || state.widgets.some((entry) => entry.secret === secret);
          if (!known || secret === TURNSTILE_DUMMY_SECRET_FAIL) {
            return { result: { success: false, "error-codes": ["invalid-input-secret"] } };
          }
          if (!state.siteverify.success || context.json.response === "") {
            return { result: { success: false, "error-codes": ["invalid-input-response"] } };
          }
          return { result: { success: true, hostname: state.siteverify.hostname, "error-codes": [] } };
        },
      },
    ] satisfies (Omit<Route, "pattern"> & { pattern: string })[]
  ).map((route) => ({ ...route, pattern: compile(route.pattern) }));

  function widget(context: Context): MockWidget {
    const found = state.widgets.find((entry) => entry.sitekey === context.params.sitekey);
    if (found === undefined) throw notFound("widget");
    return found;
  }

  function siteJson(site: MockState["analyticsSites"][number]) {
    return { site_tag: site.siteTag, site_token: site.siteToken, ruleset: { zone_name: site.host, enabled: true } };
  }

  function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }

  function errorResponse(error: MockError): Response {
    const headers: Record<string, string> =
      error.retryAfterSeconds === undefined ? {} : { "retry-after": String(error.retryAfterSeconds) };
    return json(
      error.status,
      { success: false, errors: [{ code: error.code, message: error.message }], messages: [], result: null },
      headers,
    );
  }

  function injected(routeId: string | undefined): (MockError & { applyFirst?: boolean }) | undefined {
    let hit: (MockError & { applyFirst?: boolean }) | undefined;
    for (const failure of failures) {
      if (failure.route !== "*" && failure.route !== routeId) continue;
      failure.seen += 1;
      const first = failure.nth ?? 1;
      if (hit === undefined && failure.seen >= first && failure.seen < first + (failure.times ?? 1)) {
        hit = new MockError(
          failure.status,
          failure.code ?? 10000,
          failure.message ?? "injected failure",
          failure.retryAfterSeconds,
        );
        if (failure.applyFirst === true) hit.applyFirst = true;
      }
    }
    return hit;
  }

  async function respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/client\/v4/, "");
    const route = routes.find((entry) => entry.method === request.method && entry.pattern.test(path));
    const contentType = request.headers.get("content-type") ?? "";
    let form: FormData | undefined;
    let body: Record<string, unknown> = {};
    if (contentType.includes("multipart/form-data")) form = await request.formData();
    else if (request.method !== "GET" && request.method !== "DELETE") {
      body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    }
    calls.push({
      route: route?.id,
      method: request.method,
      path,
      query: Object.fromEntries(url.searchParams),
      body: form === undefined ? body : [...form.keys()],
    });

    try {
      const failure = injected(route?.id);
      if (failure !== undefined && failure.applyFirst !== true) throw failure;
      if (route === undefined) throw new MockError(404, 7003, `No route for ${request.method} ${path}`);
      const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      if (route.auth === undefined && bearer !== state.token) throw new MockError(401, 1000, "Invalid API Token");
      if (route.permission !== undefined && denied.has(route.permission)) {
        throw new MockError(403, 10000, "Authentication error");
      }
      const params = route.pattern.exec(path)?.groups ?? {};
      if (params.account !== undefined && params.account !== state.accountId) throw notFound("account");
      const reply = await route.handle({ params, query: url.searchParams, json: body, form, bearer });
      if (failure !== undefined) throw failure;
      if (route.raw === true) return json(reply.status ?? 200, reply.result);
      let result = reply.result;
      let resultInfo: Record<string, number> | undefined;
      if (reply.paginate === true && Array.isArray(result)) {
        const page = Number(url.searchParams.get("page") ?? 1);
        const perPage = Number(url.searchParams.get("per_page") ?? 20);
        const total = result.length;
        result = result.slice((page - 1) * perPage, page * perPage);
        resultInfo = {
          page,
          per_page: perPage,
          total_count: total,
          total_pages: Math.max(1, Math.ceil(total / perPage)),
        };
      }
      return json(reply.status ?? 200, {
        success: true,
        errors: [],
        messages: [],
        result,
        ...(resultInfo === undefined ? {} : { result_info: resultInfo }),
      });
    } catch (error) {
      if (error instanceof MockError) return errorResponse(error);
      throw error;
    }
  }

  return {
    state,
    /** Every request received, in order. The Authorization header is not recorded. */
    calls,
    /** A `fetch` implementation: pass it to `createCloudflareClient({ fetch })`. */
    fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      respond(input instanceof Request ? input : new Request(input, init)),
    /** Calls to one route, for assertions. */
    callsTo(route: string): MockCall[] {
      return calls.filter((call) => call.route === route);
    },
    /** Make the Nth next call to a route (or `*`) fail with a status. */
    failNext(failure: MockFailure): void {
      failures.push({ ...failure, seen: 0 });
    },
    /** Answer 403 on every route that needs this permission, as a token without it would get. */
    denyPermission(permission: MockPermission): void {
      denied.add(permission);
    },
    allowPermission(permission: MockPermission): void {
      denied.delete(permission);
    },
    /** What the owner's click on the verification link does. */
    verifyAddress(email: string): void {
      const address = state.addresses.find((entry) => entry.email === email);
      if (address === undefined) throw new Error(`no address ${email}`);
      address.verified = new Date().toISOString();
    },
    /** Add a database without going through the API, as the Deploy button does. Returns its id. */
    addDatabase(name: string): string {
      const created = { uuid: nextId("d1"), name };
      state.databases.push(created);
      return created.uuid;
    },
    /**
     * Add a database whose API queries run on `d1`, a real or local D1 binding, as the Deploy button's database
     * is both the installer's binding and reachable through the API. Returns its id.
     */
    attachDatabase(name: string, d1: MockD1): string {
      const created = { uuid: nextId("d1"), name };
      state.databases.push(created);
      attached.set(created.uuid, d1);
      return created.uuid;
    },
    /** Run SQL on a mock database directly, as a Worker's D1 binding would. */
    sql(databaseId: string, sql: string, params: SQLInputValue[] = []): Record<string, unknown>[] {
      return runSql(databaseId, sql, params).at(-1)?.results ?? [];
    },
    /** The files the Worker serves now: path to content type and body. */
    deployedAssets(scriptName: string): Map<string, { contentType: string; body: Uint8Array }> {
      const worker = state.scripts.get(scriptName);
      const manifest = (worker === undefined ? undefined : liveVersion(worker))?.manifest ?? {};
      const files = new Map<string, { contentType: string; body: Uint8Array }>();
      for (const [path, entry] of Object.entries(manifest)) {
        const asset = state.assets.get(entry.hash);
        if (asset !== undefined) {
          files.set(path, { contentType: asset.contentType, body: Buffer.from(asset.base64, "base64") });
        }
      }
      return files;
    },
    /** The bindings of the version serving now, secrets included. */
    liveBindings(scriptName: string): MockBinding[] {
      const worker = state.scripts.get(scriptName);
      return (worker === undefined ? undefined : liveVersion(worker))?.bindings ?? [];
    },
  };
}

export type MockCloudflare = ReturnType<typeof createMockCloudflare>;
