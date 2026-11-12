import { fromBase64Url, hmacKey, toBase64Url, utf8 } from "./encoding";

/**
 * Fixed lifetime, not sliding: a session ends 30 days after login whatever happens in between, so a stolen
 * cookie cannot be kept alive forever, and no request has to rewrite the cookie.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type Session = { version: number; issuedAt: number; expiresAt: number };

const FORMAT = "v1";

function signedText(body: string): Uint8Array<ArrayBuffer> {
  return utf8(`session\n${body}`);
}

/**
 * `v1.<session version>.<issued at>.<expires at>.<HMAC-SHA256>`. The cookie holds no secret and no identity:
 * there is one workspace and one password. `version` is `workspace.session_version` at login.
 */
export async function issueSessionToken(sessionKey: string, version: number, now: number): Promise<string> {
  const body = `${FORMAT}.${version}.${now}.${now + SESSION_TTL_MS}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(sessionKey), signedText(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * The session, or null when the token is malformed, not signed with this key, expired, or older than the
 * workspace's current session version (password changed, or logged out everywhere).
 */
export async function verifySessionToken(
  sessionKey: string,
  token: string,
  current: { sessionVersion: number; now: number },
): Promise<Session | null> {
  const match = /^(v1\.(\d{1,15})\.(\d{1,15})\.(\d{1,15}))\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (match === null) return null;
  const [, body = "", version, issuedAt, expiresAt, signature = ""] = match;
  const signatureBytes = fromBase64Url(signature);
  if (signatureBytes === null) return null;
  // `verify` compares in constant time.
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(sessionKey), signatureBytes, signedText(body));
  if (!valid) return null;
  const session = { version: Number(version), issuedAt: Number(issuedAt), expiresAt: Number(expiresAt) };
  if (session.expiresAt <= current.now || session.version !== current.sessionVersion) return null;
  return session;
}

/**
 * Plain http is accepted on the developer's own machine only. Everywhere else the cookie is `Secure` and
 * carries the `__Host-` prefix, which browsers refuse without `Secure`, with a `Domain`, or off `Path=/`.
 */
function isLocalHttp(url: URL): boolean {
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export function sessionCookieName(url: URL): string {
  return isLocalHttp(url) ? "deparked_session" : "__Host-deparked_session";
}

/**
 * Host-only (no `Domain`): the admin runs on `workers.dev` and on every managed domain, and each keeps its own
 * login. `SameSite=Strict`: the cookie is never sent on a request that another site started.
 */
function cookie(url: URL, value: string, maxAgeSeconds: number): string {
  const secure = isLocalHttp(url) ? "" : "; Secure";
  return `${sessionCookieName(url)}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly${secure}; SameSite=Strict`;
}

export function sessionCookie(url: URL, token: string): string {
  return cookie(url, token, Math.floor(SESSION_TTL_MS / 1000));
}

export function clearedSessionCookie(url: URL): string {
  return cookie(url, "", 0);
}

export function readSessionToken(request: Request): string | null {
  const name = sessionCookieName(new URL(request.url));
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}
