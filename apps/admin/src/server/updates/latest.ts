// Where an installed admin learns of a newer release: the upstream repository's latest GitHub Release, never the
// owner's copy of the installer.
//
// Trust model (the installer pins one version and the SHA-256 of its release.json; an update needs a new pin):
// the admin reads the newest release's version and the SHA-256 GitHub computed for its release.json, shows both,
// and installs nothing until the owner confirms that exact pin. Every file is then checked against it, as the
// installer checks its own. Nothing updates on its own. Signed releases can replace the confirmation later.
import { z } from "zod";
import { loopbackOverride } from "../hosting-env";

export const UPSTREAM_REPOSITORY = "dominic-schmid/deparked";
const LATEST_URL = `https://api.github.com/repos/${UPSTREAM_REPOSITORY}/releases/latest`;
const DOWNLOAD_URL = `https://github.com/${UPSTREAM_REPOSITORY}/releases/download`;

/** The newest release: its pin and its page, for the release notes. */
export interface LatestRelease {
  version: string;
  sha256: string;
  notesUrl: string;
}

export type LatestResult = { ok: true; release: LatestRelease } | { ok: false; message: string };

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** release.json.sha256 is one line: the hash and the file name. */
const MAX_SHA_FILE_BYTES = 256;

const githubRelease = z.object({
  tag_name: z.string(),
  html_url: z.url({ protocol: /^https?$/ }),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.url({ protocol: /^https?$/ }),
      digest: z.string().nullish(),
    }),
  ),
});

type Vars = Record<string, unknown>;
const text = (vars: Vars, name: string) => (typeof vars[name] === "string" ? (vars[name] as string) : undefined);

/** Where releases are looked up and downloaded. The variables exist for tests on this machine only. */
export function releaseLocation(vars: Vars) {
  const latest = loopbackOverride(text(vars, "RELEASE_LATEST_URL")) ?? LATEST_URL;
  const download = (loopbackOverride(text(vars, "RELEASE_DOWNLOAD_URL")) ?? DOWNLOAD_URL).replace(/\/+$/, "");
  return { latest, releaseUrl: (version: string) => `${download}/v${version}` };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const UNREACHABLE = "Could not reach GitHub to look for a newer release. Try again later.";
const UNREADABLE = "GitHub's answer about the newest release could not be read. Try again later.";

async function hashFromFile(url: string, fetchFile: Fetch): Promise<string | null> {
  const response = await fetchFile(url, { headers: { "user-agent": "deparked-admin" } });
  if (!response.ok) return null;
  const line = (await response.text()).slice(0, MAX_SHA_FILE_BYTES);
  const hash = line.split(/\s/)[0]?.toLowerCase() ?? "";
  return SHA256.test(hash) ? hash : null;
}

/**
 * The newest release and its pin. The hash is GitHub's digest of the release.json asset, or, for an asset without
 * one, the release's own release.json.sha256. Only reads; one or two requests.
 */
export async function fetchLatestRelease(
  url: string,
  fetchFile: Fetch = (u, init) => fetch(u, init),
): Promise<LatestResult> {
  let response: Response;
  try {
    response = await fetchFile(url, {
      headers: { accept: "application/vnd.github+json", "user-agent": "deparked-admin" },
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
  if (response.status === 404) return { ok: false, message: "No Deparked release is published yet." };
  if (!response.ok) return { ok: false, message: UNREACHABLE };
  let parsed: z.infer<typeof githubRelease>;
  try {
    parsed = githubRelease.parse(await response.json());
  } catch {
    return { ok: false, message: UNREADABLE };
  }
  const version = parsed.tag_name.replace(/^v/, "");
  if (!VERSION.test(version)) return { ok: false, message: UNREADABLE };
  const manifest = parsed.assets.find((asset) => asset.name === "release.json");
  if (manifest === undefined) return { ok: false, message: `Deparked ${version} has no release.json.` };
  let sha256 = /^sha256:([0-9a-f]{64})$/.exec(manifest.digest ?? "")?.[1] ?? null;
  if (sha256 === null) {
    const file = parsed.assets.find((asset) => asset.name === "release.json.sha256");
    try {
      sha256 = file === undefined ? null : await hashFromFile(file.browser_download_url, fetchFile);
    } catch {
      return { ok: false, message: UNREACHABLE };
    }
  }
  if (sha256 === null) {
    return { ok: false, message: `Deparked ${version} publishes no checksum, so it cannot be installed from here.` };
  }
  return { ok: true, release: { version, sha256, notesUrl: parsed.html_url } };
}
