import { env } from "cloudflare:workers";

/** The release this isolate runs: the `DEPARKED_RELEASE` binding the install and every update set. Null in development. */
export function runningRelease(): string | null {
  const value = (env as unknown as Record<string, unknown>).DEPARKED_RELEASE;
  return typeof value === "string" && value !== "" ? value : null;
}
