import { type Db, getReleaseState, updateReleaseState } from "@deparked/db";
import {
  compareVersions,
  type HubSetup,
  RELEASE_VERSION,
  type ReleasePin,
  type ReleaseStatus,
} from "@deparked/hosting";
import { z } from "zod";
import { type LatestRelease, type LatestResult, UPSTREAM_REPOSITORY } from "./latest";

/** How long the last look at GitHub counts: opening Updates asks again after this. "Check again" always asks. */
export const LATEST_TTL_MS = 60 * 60_000;

export const pinSchema = z.object({
  version: z.string().max(64).regex(RELEASE_VERSION, "Not a release version."),
  sha256: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{64}$/, "Not a SHA-256 checksum."),
});

export interface UpdatesView {
  status: ReleaseStatus;
  /** The release this admin runs (its `DEPARKED_RELEASE`), or null for a build that was not installed from one. */
  running: string | null;
  latest: (LatestRelease & { checkedAt: number }) | null;
  /** Why the last look at GitHub failed. */
  checkError: string | null;
  /** True when `latest` is newer than the installed release. */
  available: boolean;
  steps: { id: string; title: string }[];
  /** When the server answered, for "checked 5 minutes ago". */
  now: number;
}

export function notesUrl(version: string): string {
  return `https://github.com/${UPSTREAM_REPOSITORY}/releases/tag/v${version}`;
}

/** `a` is a later version than `b`, by semantic version precedence (`1.2.0` is newer than `1.2.0-rc.3`). */
export function newer(a: string, b: string): boolean {
  return compareVersions(a, b) > 0;
}

/** The last stored look at GitHub. */
export async function storedLatest(db: Db): Promise<UpdatesView["latest"]> {
  const state = await getReleaseState(db);
  if (state?.latestVersion == null || state.latestSha256 == null || state.latestCheckedAt == null) return null;
  return {
    version: state.latestVersion,
    sha256: state.latestSha256,
    notesUrl: notesUrl(state.latestVersion),
    checkedAt: state.latestCheckedAt,
  };
}

/**
 * Asks GitHub again when forced or when the stored answer is older than `LATEST_TTL_MS`, and stores a good answer
 * (version and hash in one write). A failed look keeps the stored one.
 */
export async function refreshLatest(input: {
  db: Db;
  now: number;
  force: boolean;
  fetchLatest: () => Promise<LatestResult>;
}): Promise<{ latest: UpdatesView["latest"]; checkError: string | null }> {
  const stored = await storedLatest(input.db);
  if (!input.force && stored !== null && input.now - stored.checkedAt < LATEST_TTL_MS) {
    return { latest: stored, checkError: null };
  }
  const result = await input.fetchLatest();
  if (!result.ok) return { latest: stored, checkError: result.message };
  await updateReleaseState(input.db, {
    latestVersion: result.release.version,
    latestSha256: result.release.sha256,
    latestCheckedAt: input.now,
  });
  return { latest: { ...result.release, checkedAt: input.now }, checkError: null };
}

export function isAvailable(status: ReleaseStatus, latest: UpdatesView["latest"]): boolean {
  if (latest === null || status.installed === null) return false;
  return newer(latest.version, status.installed.version);
}

const CHANGED = "The newest release changed since you looked. Check again, then confirm.";

/**
 * The pin the owner was shown, if it is still the newest release this admin found: previews and updates only
 * ever use that one, never any other pin the browser sends.
 */
export async function shownPin(
  db: Db,
  pin: ReleasePin,
): Promise<{ ok: true; pin: ReleasePin } | { ok: false; message: string }> {
  const latest = await storedLatest(db);
  if (latest === null || latest.version !== pin.version || latest.sha256 !== pin.sha256) {
    return { ok: false, message: CHANGED };
  }
  return { ok: true, pin: { version: latest.version, sha256: latest.sha256 } };
}

export async function previewUpdate(input: { db: Db; hub: HubSetup; pin: ReleasePin }) {
  const shown = await shownPin(input.db, input.pin);
  return shown.ok ? input.hub.previewUpdate(shown.pin) : shown;
}

export async function startUpdate(input: { db: Db; hub: HubSetup; pin: ReleasePin }) {
  const shown = await shownPin(input.db, input.pin);
  return shown.ok ? input.hub.startUpdate(shown.pin) : shown;
}

/**
 * The new admin has to answer the finish itself: a build without a release (local development) says nothing about
 * itself. The hub checks the rest (installed, republished after the upload).
 */
export function finishBlocker(change: ReleaseStatus["change"], running: string | null): string | null {
  if (change === null) return "No update is running.";
  if (change.finished || running === null || running === change.pin.version) return null;
  return `The admin still runs ${running}. Wait a few seconds for ${change.pin.version} to take over, then retry.`;
}
