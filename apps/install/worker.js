// Spike 2 throwaway harness for DOM-370. Not product code; never merged to main.
import page from "./page.html";
import adminSrc from "./admin.txt";

const API = "https://api.cloudflare.com/client/v4";
const SITES = "deparked-test-s2-sites";
const ADMIN = "deparked-test-s2-admin";
const COMPAT = "2026-10-01";
const RELEASE_URL = "https://raw.githubusercontent.com/dominic-schmid/deparked/spike-dom-370/apps/install/admin.txt";

const json = (o, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: { "content-type": "application/json" } });

// Every outbound call goes through this, so each response reports its subrequest count.
function client(token) {
  let n = 0;
  const raw = (url, init) => (n++, fetch(url, init));
  async function cf(method, path, body, auth = token) {
    const headers = { authorization: `Bearer ${auth}` };
    let b = body;
    if (body !== undefined && !(body instanceof FormData)) {
      headers["content-type"] = "application/json";
      b = JSON.stringify(body);
    }
    const r = await raw(API + path, { method, headers, body: b });
    const j = await r.json().catch(() => ({ success: false, errors: [{ message: `HTTP ${r.status}, not JSON` }] }));
    if (!j.success) throw Object.assign(new Error(`${method} ${path.replace(/[0-9a-f]{32}/g, ":id")} → HTTP ${r.status} ${JSON.stringify(j.errors)}`), { status: r.status });
    return j;
  }
  return { cf, count: () => n };
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

async function connect(env, token) {
  const { cf, count } = client(token);
  // 1. Write a one-time value through the binding.
  const nonce = randomHex(16);
  await env.DB.exec("CREATE TABLE IF NOT EXISTS spike_nonce (id INTEGER PRIMARY KEY, nonce TEXT NOT NULL, created_at TEXT NOT NULL)");
  await env.DB.prepare("INSERT OR REPLACE INTO spike_nonce (id, nonce, created_at) VALUES (1, ?, datetime('now'))").bind(nonce).run();

  // 2. Is the token valid at all? User token first, account token second.
  let tokenKind = "user";
  let tokenStatus;
  try {
    tokenStatus = (await cf("GET", "/user/tokens/verify")).result.status;
  } catch {
    tokenKind = "account";
  }

  // 3. Find our database through the API and read the value back.
  const accounts = (await cf("GET", "/accounts?per_page=50")).result;
  const tried = [];
  for (const a of accounts) {
    if (tokenKind === "account" && !tokenStatus) {
      tokenStatus = (await cf("GET", `/accounts/${a.id}/tokens/verify`).catch(() => ({ result: {} }))).result.status;
    }
    const dbs = (await cf("GET", `/accounts/${a.id}/d1/database?per_page=100`)).result;
    dbs.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
    for (const db of dbs) {
      tried.push(db.name);
      const q = await cf("POST", `/accounts/${a.id}/d1/database/${db.uuid}/query`, { sql: "SELECT nonce FROM spike_nonce WHERE id = 1" }).catch(() => null);
      const got = q?.result?.[0]?.results?.[0]?.nonce;
      if (got === nonce) {
        await env.DB.prepare("DELETE FROM spike_nonce WHERE id = 1").run(); // one-time
        return { owned: true, tokenKind, tokenStatus, accountId: a.id, dbId: db.uuid, dbName: db.name, triedDbs: tried, subrequests: count() };
      }
    }
  }
  return { owned: false, tokenKind, tokenStatus, accounts: accounts.length, triedDbs: tried, subrequests: count() };
}

// Plain-words permission check: probe one cheap read per needed permission.
async function probe(token, accountId) {
  const { cf, count } = client(token);
  const checks = {
    "Workers Scripts": `/accounts/${accountId}/workers/scripts`,
    D1: `/accounts/${accountId}/d1/database?per_page=1`,
    "Email Routing Addresses": `/accounts/${accountId}/email/routing/addresses?per_page=1`,
  };
  const out = {};
  for (const [name, path] of Object.entries(checks)) {
    out[name] = await cf("GET", path).then(() => "ok", (e) => `missing (${e.status})`);
  }
  return { permissions: out, subrequests: count() };
}

async function createSites(token, accountId) {
  const { cf, count } = client(token);
  const html = `<!doctype html><meta charset=utf-8><title>deparked spike 2</title><h1>sites ok ${new Date().toISOString()}</h1>`;
  const path = "/sites/spike.test/index.html";
  const hash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html))).slice(0, 32);
  const manifest = { [path]: { hash, size: new TextEncoder().encode(html).length } };
  const session = (await cf("POST", `/accounts/${accountId}/workers/scripts/${SITES}/assets-upload-session`, { manifest })).result;
  let completion = session.jwt;
  if (session.buckets?.length) {
    const form = new FormData();
    form.append(hash, new File([b64(html)], hash, { type: "text/html" }));
    completion = (await cf("POST", `/accounts/${accountId}/workers/assets/upload?base64=true`, form, session.jwt)).result.jwt;
  }
  const metadata = { compatibility_date: COMPAT, assets: { jwt: completion, config: { html_handling: "none", not_found_handling: "none" } } };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  const put = await cf("PUT", `/accounts/${accountId}/workers/scripts/${SITES}`, form);
  await cf("POST", `/accounts/${accountId}/workers/scripts/${SITES}/subdomain`, { enabled: true, previews_enabled: false });
  return { ok: true, uploadedFiles: session.buckets?.flat().length ?? 0, hasAssets: put.result?.has_assets, testPath: path, subrequests: count() };
}

async function createAdmin(token, accountId, dbId) {
  const { cf, count } = client(token);
  const setupSecret = randomHex(32);
  const metadata = {
    main_module: "admin.js",
    compatibility_date: COMPAT,
    observability: { enabled: true },
    bindings: [
      { type: "d1", name: "DB", id: dbId },
      { type: "secret_text", name: "CF_TOKEN", text: token },
      { type: "secret_text", name: "SETUP_SECRET", text: setupSecret },
      { type: "plain_text", name: "ACCOUNT_ID", text: accountId },
      { type: "plain_text", name: "SCRIPT_NAME", text: ADMIN },
      { type: "plain_text", name: "RELEASE_URL", text: RELEASE_URL },
    ],
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("admin.js", new Blob([adminSrc.replace("__VERSION__", "1")], { type: "application/javascript+module" }), "admin.js");
  await cf("PUT", `/accounts/${accountId}/workers/scripts/${ADMIN}`, form);
  await cf("POST", `/accounts/${accountId}/workers/scripts/${ADMIN}/subdomain`, { enabled: true, previews_enabled: false });
  const sub = (await cf("GET", `/accounts/${accountId}/workers/subdomain`)).result.subdomain;
  // The harness shows the setup secret so the owner can trigger /update; the real one hands it over once.
  return { ok: true, adminUrl: `https://${ADMIN}.${sub}.workers.dev`, sitesUrl: `https://${SITES}.${sub}.workers.dev`, setupSecret, subrequests: count() };
}

async function notify(token, accountId, email) {
  const { cf, count } = client(token);
  const r = (await cf("POST", `/accounts/${accountId}/email/routing/addresses`, { email })).result;
  return { ok: true, id: r.id ?? r.tag, verified: r.verified ?? null, subrequests: count() };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (req.method !== "POST" || !url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    const body = await req.json().catch(() => ({}));
    if (typeof body.token !== "string" || body.token.length < 20) return json({ error: "token missing" }, 400);
    try {
      switch (url.pathname) {
        case "/api/connect": return json(await connect(env, body.token));
        case "/api/probe": return json(await probe(body.token, body.accountId));
        case "/api/sites": return json(await createSites(body.token, body.accountId));
        case "/api/admin": return json(await createAdmin(body.token, body.accountId, body.dbId));
        case "/api/notify": return json(await notify(body.token, body.accountId, body.email));
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e.message) }, 502);
    }
  },
};
