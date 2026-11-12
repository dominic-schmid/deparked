import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../server/auth/password";

export const NEW_PASSWORD_ERRORS = {
  too_short: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_long: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  mismatch: "The two passwords are not the same.",
} as const;

export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters. A few random words work well.`;

export function lockedMessage(retryMinutes: number | undefined): string {
  const wait =
    retryMinutes === undefined ? "a few minutes" : retryMinutes === 1 ? "1 minute" : `${retryMinutes} minutes`;
  return `Too many attempts. Try again in ${wait}.`;
}

/** Search params arrive parsed and untrusted: keep `value` only when it is one of `allowed`. */
export function oneOf<const T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

export function retryMinutes(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 60 ? value : undefined;
}

export function retrySearch(retryAfterMs: number): string {
  return `retry=${Math.max(1, Math.ceil(retryAfterMs / 60_000))}`;
}
