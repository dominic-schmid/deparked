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
 * Plain http is accepted on the developer's own machine only. Everywhere else cookies are `Secure` and carry the
 * `__Host-` prefix, which browsers refuse without `Secure`, with a `Domain`, or off `Path=/`.
 */
function isLocalHttp(url: URL): boolean {
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** Where a plain-http request must go instead, or null when it may be served (https, or local dev). */
export function httpsRedirect(url: URL): string | null {
  if (url.protocol !== "http:" || isLocalHttp(url)) return null;
  const target = new URL(url);
  target.protocol = "https:";
  return target.href;
}

function cookieName(url: URL, name: string): string {
  return isLocalHttp(url) ? name : `__Host-${name}`;
}

/**
 * Host-only (no `Domain`): the admin runs on `workers.dev` and on every managed domain, and each keeps its own
 * login. `SameSite=Strict`: the cookie is never sent on a request that another site started.
 */
function cookie(url: URL, name: string, value: string, maxAgeSeconds: number): string {
  const secure = isLocalHttp(url) ? "" : "; Secure";
  return `${cookieName(url, name)}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly${secure}; SameSite=Strict`;
}

function readCookie(request: Request, name: string): string | null {
  const fullName = cookieName(new URL(request.url), name);
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === fullName) return part.slice(separator + 1).trim();
  }
  return null;
}

const SESSION = "deparked_session";

export function sessionCookieName(url: URL): string {
  return cookieName(url, SESSION);
}

export function sessionCookie(url: URL, token: string): string {
  return cookie(url, SESSION, token, Math.floor(SESSION_TTL_MS / 1000));
}

export function clearedSessionCookie(url: URL): string {
  return cookie(url, SESSION, "", 0);
}

export function readSessionToken(request: Request): string | null {
  return readCookie(request, SESSION);
}

// The one-time setup secret arrives in the installer's link. It is moved out of the URL into this cookie at once,
// so it does not stay in the address bar, the history or a later redirect. The setup form's POST reads it back.
const SETUP = "deparked_setup";
const SETUP_COOKIE_SECONDS = 60 * 60;
const SETUP_SECRET_MAX_LENGTH = 512;

/** Null when the secret is empty or too long to be one. */
export function setupSecretCookie(url: URL, secret: string): string | null {
  if (secret === "" || secret.length > SETUP_SECRET_MAX_LENGTH) return null;
  return cookie(url, SETUP, encodeURIComponent(secret), SETUP_COOKIE_SECONDS);
}

export function clearedSetupSecretCookie(url: URL): string {
  return cookie(url, SETUP, "", 0);
}

export function readSetupSecret(request: Request): string | null {
  const value = readCookie(request, SETUP);
  if (value === null || value === "") return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
