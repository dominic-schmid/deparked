import { VERSION } from "@deparked/provision";
import packageJson from "../../package.json" with { type: "json" };

/** The release this installer installs: one version and the SHA-256 of its release.json (decision doc, section 13). */
export interface Pin {
  version: string;
  sha256: string;
}

/**
 * Set after each release is published (the release workflow prints the hash). Null until the first release: the
 * installer then explains that there is nothing to install yet.
 */
export const PINNED_RELEASE: Pin | null = null;

export const INSTALLER_VERSION: string = packageJson.version;

/** Releases come from the upstream repository, never from the owner's copy of the installer. */
export const UPSTREAM_REPOSITORY = "dominic-schmid/deparked";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Tests only: the mock Cloudflare API. Honoured for plain http to a loopback address with a port. */
  CLOUDFLARE_API_BASE?: string;
  /** Another release than the pinned one: both are needed. Set as Worker variables in the owner's copy. */
  RELEASE_VERSION?: string;
  RELEASE_SHA256?: string;
  /** Where the release files are, `<base>/release.json`: https, or plain http to a loopback address (tests). */
  RELEASE_BASE_URL?: string;
}

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port !== "";
}

function parseUrl(value: string | undefined): URL | null {
  if (value === undefined || value === "") return null;
  try {
    const url = new URL(value);
    return url.username === "" && url.password === "" && url.search === "" && url.hash === "" ? url : null;
  } catch {
    return null;
  }
}

/** The mock's base URL in tests; undefined (Cloudflare's own API) for anything else. */
export function apiBase(env: Env): string | undefined {
  const url = parseUrl(env.CLOUDFLARE_API_BASE);
  return url !== null && isLoopbackHttp(url) ? url.toString().replace(/\/$/, "") : undefined;
}

export function releasePin(env: Env): Pin | null {
  if (env.RELEASE_VERSION !== undefined && env.RELEASE_VERSION !== "") {
    const sha256 = env.RELEASE_SHA256?.toLowerCase() ?? "";
    // Both go into a download URL: anything but a plain version and a hex hash counts as no pin.
    return VERSION.test(env.RELEASE_VERSION) && /^[0-9a-f]{64}$/.test(sha256)
      ? { version: env.RELEASE_VERSION, sha256 }
      : null;
  }
  return PINNED_RELEASE;
}

export function releaseBaseUrl(env: Env, pin: Pin): string {
  const url = parseUrl(env.RELEASE_BASE_URL);
  if (url !== null && (url.protocol === "https:" || isLoopbackHttp(url))) return url.toString().replace(/\/$/, "");
  return `https://github.com/${UPSTREAM_REPOSITORY}/releases/download/v${pin.version}`;
}
