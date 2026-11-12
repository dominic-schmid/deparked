import {
  clearRateLimit,
  consumeSetupSecret,
  type Db,
  getWorkspace,
  hitRateLimit,
  setPassword,
  type Workspace,
} from "@deparked/db";
import { hmacKey, sha256Hex, timingSafeEqual, toHex, utf8 } from "./encoding";
import { hashPassword, type PasswordHash, verifyPassword } from "./password";
import { issueSessionToken } from "./session";

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** What the installer stores in `workspace.setup_secret_hash`: lowercase hex SHA-256 of the secret. */
export function hashSetupSecret(secret: string): Promise<string> {
  return sha256Hex(secret);
}

export function isSetupPending(workspace: Workspace | undefined, now: number): boolean {
  return (
    workspace !== undefined &&
    workspace.setupSecretHash !== null &&
    workspace.setupSecretExpiresAt !== null &&
    workspace.setupSecretExpiresAt > now
  );
}

function storedPassword(workspace: Workspace | undefined): PasswordHash | null {
  if (!workspace?.passwordHash || !workspace.passwordSalt || !workspace.passwordIterations) return null;
  return { hash: workspace.passwordHash, salt: workspace.passwordSalt, iterations: workspace.passwordIterations };
}

/** `login:<HMAC-SHA256(SESSION_KEY, ip)>`: the database never sees an IP address, and the hash cannot be reversed
 * by trying all addresses without the Worker secret. */
export async function loginRateLimitKey(sessionKey: string, ip: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(sessionKey), utf8(`ip\n${ip}`));
  return `login:${toHex(new Uint8Array(mac))}`;
}

export type SetupResult = { ok: true; token: string } | { ok: false; reason: "invalid_secret" };

/**
 * First-run setup and recovery. The secret is checked first, so a wrong link costs no password hashing. The
 * write itself (`consumeSetupSecret`) checks the secret again, stores the password and deletes the secret in
 * one SQL statement: of two requests with the same secret, exactly one succeeds. Ends every earlier session.
 */
export async function completeSetup(
  db: Db,
  input: { secret: string; password: string; sessionKey: string; now: number },
): Promise<SetupResult> {
  const invalid: SetupResult = { ok: false, reason: "invalid_secret" };
  const workspace = await getWorkspace(db);
  const secretHash = await hashSetupSecret(input.secret);
  if (!isSetupPending(workspace, input.now)) return invalid;
  if (!timingSafeEqual(utf8(secretHash), utf8(workspace?.setupSecretHash ?? ""))) return invalid;
  const password = await hashPassword(input.password);
  const sessionVersion = await consumeSetupSecret(db, {
    secretHash,
    passwordHash: password.hash,
    passwordSalt: password.salt,
    passwordIterations: password.iterations,
    now: input.now,
  });
  if (sessionVersion === null) return invalid;
  return { ok: true, token: await issueSessionToken(input.sessionKey, sessionVersion, input.now) };
}

export type PasswordCheckFailure =
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; retryAfterMs: number };

/**
 * Counts the attempt for this IP, then checks the password. Past the limit nothing is checked until the window
 * ends, not even the right password, so a locked-out caller learns nothing. A success clears the counter.
 */
async function checkPassword(
  db: Db,
  input: { password: string; ip: string; sessionKey: string; now: number },
): Promise<{ ok: true; workspace: Workspace } | PasswordCheckFailure> {
  const key = await loginRateLimitKey(input.sessionKey, input.ip);
  const hit = await hitRateLimit(db, { key, windowMs: LOGIN_WINDOW_MS, now: input.now });
  if (hit.count > LOGIN_MAX_ATTEMPTS) {
    return { ok: false, reason: "locked", retryAfterMs: hit.windowStart + LOGIN_WINDOW_MS - input.now };
  }
  const workspace = await getWorkspace(db);
  const stored = storedPassword(workspace);
  if (workspace === undefined || stored === null || !(await verifyPassword(input.password, stored))) {
    return { ok: false, reason: "invalid" };
  }
  await clearRateLimit(db, key);
  return { ok: true, workspace };
}

export type LoginResult = { ok: true; token: string } | PasswordCheckFailure;

export async function login(
  db: Db,
  input: { password: string; ip: string; sessionKey: string; now: number },
): Promise<LoginResult> {
  const check = await checkPassword(db, input);
  if (!check.ok) return check;
  return { ok: true, token: await issueSessionToken(input.sessionKey, check.workspace.sessionVersion, input.now) };
}

/**
 * Needs the current password (rate-limited like a login). Bumps `session_version`, which ends every session
 * including the caller's, and returns a token for the new version so the caller stays logged in.
 */
export async function changePassword(
  db: Db,
  input: { currentPassword: string; newPassword: string; ip: string; sessionKey: string; now: number },
): Promise<LoginResult> {
  const check = await checkPassword(db, { ...input, password: input.currentPassword });
  if (!check.ok) return check;
  const password = await hashPassword(input.newPassword);
  const sessionVersion = await setPassword(db, {
    passwordHash: password.hash,
    passwordSalt: password.salt,
    passwordIterations: password.iterations,
    now: input.now,
  });
  if (sessionVersion === null) return { ok: false, reason: "invalid" };
  return { ok: true, token: await issueSessionToken(input.sessionKey, sessionVersion, input.now) };
}
