import { readAtMost } from "@deparked/provision";
import type { CheckRequest, FinishRequest, StepRequest } from "./api";
import type { Env } from "./server/config";
import { check, finish, rollback, status, step } from "./server/install";

const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex" };
const MAX_BODY = 4096;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function refuse(status: number, message: string): Response {
  return json({ ok: false, error: "bad-request", message }, status);
}

/**
 * Every POST must come from this installer's own page: same origin, JSON body. A cross-site form cannot send
 * JSON, and a cross-site script cannot without a preflight this Worker never answers.
 */
function checkMutation(request: Request, url: URL): Response | null {
  if (request.headers.get("origin") !== url.origin)
    return refuse(403, "This request did not come from the installer page.");
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return refuse(415, "Send JSON.");
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) return refuse(413, "The request is too large.");
  return null;
}

/** Reads at most `MAX_BODY` bytes from the stream, whatever `content-length` says. */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const bytes = await readAtMost(new Response(request.body), MAX_BODY);
  if (bytes === null) return null;
  const text = new TextDecoder().decode(bytes);
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const TOKEN = /^[A-Za-z0-9_.-]{20,200}$/;
const ACCOUNT = /^[A-Za-z0-9_-]{1,64}$/;

function token(body: Record<string, unknown>): string | null {
  const value = typeof body.token === "string" ? body.token.trim() : "";
  return TOKEN.test(value) ? value : null;
}

function accountId(body: Record<string, unknown>): string | null {
  return typeof body.accountId === "string" && ACCOUNT.test(body.accountId) ? body.accountId : null;
}

const NOT_A_TOKEN =
  "That does not look like a Cloudflare API token. Copy the whole token from Cloudflare's page (a long line of letters and digits), then paste it here.";

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/status") {
    if (request.method !== "GET") return refuse(405, "Use GET.");
    return json(await status(env));
  }
  if (request.method !== "POST") return refuse(405, "Use POST.");
  const refused = checkMutation(request, url);
  if (refused !== null) return refused;
  const body = await readBody(request);
  if (body === null) return refuse(400, "The request could not be read, or it is too large.");
  const pasted = token(body);
  if (pasted === null) return json({ ok: false, error: "invalid-token", message: NOT_A_TOKEN }, 400);
  const account = accountId(body);
  // Only for the per-address throttle, hashed there. Local runs have no such header.
  const clientIp = request.headers.get("cf-connecting-ip") ?? "local";
  switch (url.pathname) {
    case "/api/check": {
      const input: CheckRequest = account === null ? { token: pasted } : { token: pasted, accountId: account };
      return json(await check(env, input, clientIp));
    }
    case "/api/step":
    case "/api/rollback": {
      const next = body.next;
      if (account === null || typeof next !== "number" || !Number.isInteger(next) || next < 0 || next > 20) {
        return refuse(400, "The request is missing the account or the step.");
      }
      const input: StepRequest = { token: pasted, accountId: account, next };
      return json(await (url.pathname === "/api/step" ? step : rollback)(env, input, clientIp));
    }
    case "/api/finish": {
      if (account === null) return refuse(400, "The request is missing the account.");
      const input: FinishRequest = { token: pasted, accountId: account };
      return json(await finish(env, input, clientIp));
    }
    default:
      return refuse(404, "No such call.");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return Response.json({ ok: true, worker: "deparked-install" }, { headers: NO_STORE });
    if (url.pathname.startsWith("/api/")) return api(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
