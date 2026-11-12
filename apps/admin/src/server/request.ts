import { env } from "cloudflare:workers";
import { createDb, type Db, getWorkspace, type Workspace } from "@deparked/db";
import { readSessionToken, type Session, verifySessionToken } from "./auth/session";

/** What the auth module needs from one request. Read per request, never at module scope. */
export type AuthRequest = { db: Db; sessionKey: string; url: URL; ip: string; now: number };

export function authRequest(request: Request): AuthRequest {
  return {
    db: createDb(env.DB),
    sessionKey: env.SESSION_KEY,
    url: new URL(request.url),
    // Cloudflare sets this header itself and overwrites what a client sends. Absent only in local dev.
    ip: request.headers.get("CF-Connecting-IP") ?? "local",
    now: Date.now(),
  };
}

/** The workspace row and the request's session, checked against the row's current session version. */
export async function readSession(
  request: Request,
): Promise<{ workspace: Workspace | undefined; session: Session | null }> {
  const { db, sessionKey, now } = authRequest(request);
  const workspace = await getWorkspace(db);
  const token = readSessionToken(request);
  if (workspace === undefined || token === null) return { workspace, session: null };
  const session = await verifySessionToken(sessionKey, token, { sessionVersion: workspace.sessionVersion, now });
  return { workspace, session };
}

export function seeOther(location: string, ...setCookies: string[]): Response {
  const headers = new Headers({ Location: location });
  for (const setCookie of setCookies) headers.append("Set-Cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

/** The posted form's text fields, or null when the body is not a form. Missing fields read as "". */
export async function readForm(request: Request): Promise<((name: string) => string) | null> {
  try {
    const form = await request.formData();
    return (name) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
  } catch {
    return null;
  }
}

export function badForm(): Response {
  return new Response("Bad request", { status: 400 });
}
