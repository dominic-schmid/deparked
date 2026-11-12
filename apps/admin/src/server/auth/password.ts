import { fromBase64Url, randomBytes, timingSafeEqual, toBase64Url, utf8 } from "./encoding";

/**
 * PBKDF2-SHA256 through WebCrypto, the only password KDF Workers has natively.
 *
 * Why 25,000: Workers Free allows 10 ms CPU per request, and changing the password derives twice in one request
 * (check the current one, hash the new one). Measured in local workerd (Xeon 2.1 GHz with SHA-NI): 100,000
 * iterations take about 14 ms per derivation, 25,000 about 3.6 ms, so a login costs about 3.6 ms and a change
 * about 7.2 ms. workerd also refuses more than 100,000. This is weaker than OWASP's 600,000, deliberately: the
 * hash only reaches someone who can already read the owner's own D1, guesses over the network are rate-limited,
 * and passwords need 10 characters. The count is stored with each hash, so raising it later breaks no login.
 */
export const PBKDF2_ITERATIONS = 25_000;
export const PASSWORD_MIN_LENGTH = 10;
/** A bound on the work one request can ask for, far above any real password or passphrase. */
export const PASSWORD_MAX_LENGTH = 1024;

const SALT_BYTES = 16;
const HASH_BITS = 256;

export type PasswordHash = { hash: string; salt: string; iterations: number };

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  // NFKC: the same password typed on another keyboard or platform gives the same bytes.
  const key = await crypto.subtle.importKey("raw", utf8(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations: number = PBKDF2_ITERATIONS): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, iterations);
  return { hash: toBase64Url(hash), salt: toBase64Url(salt), iterations };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const salt = fromBase64Url(stored.salt);
  const expected = fromBase64Url(stored.hash);
  if (salt === null || expected === null || password.length > PASSWORD_MAX_LENGTH) return false;
  return timingSafeEqual(await derive(password, salt, stored.iterations), expected);
}

export type NewPasswordError = "too_short" | "too_long" | "mismatch";

export function checkNewPassword(password: string, confirmation: string): NewPasswordError | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "too_short";
  if (password.length > PASSWORD_MAX_LENGTH) return "too_long";
  if (password !== confirmation) return "mismatch";
  return null;
}
