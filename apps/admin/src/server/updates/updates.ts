import {
  type Db,
  getReleaseState,
  getWorkspace,
  listDeployments,
  updateReleaseState,
  updateWorkspace,
} from "@deparked/db";
import type { HubSetup, ReleaseChange, ReleasePin, ReleaseStatus } from "@deparked/hosting";
import { z } from "zod";
import { type LatestRelease, type LatestResult, UPSTREAM_REPOSITORY } from "./latest";

/** How long the last look at GitHub counts: opening Updates asks again after this. "Check again" always asks. */
export const LATEST_TTL_MS = 60 * 60_000;

export const pinSchema = z.object({
  version: z
    .string()
    .max(64)
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Not a release version."),
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

const parts = (version: string) => (version.split("-")[0] ?? "").split(".").map(Number);

/** `a` is a later `x.y.z` than `b` (a pre-release counts as its version, as the installer counts it). */
export function newer(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (x[index] ?? 0) - (y[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/** The last stored look at GitHub. */
export async function storedLatest(db: Db): Promise<UpdatesView["latest"]> {
  const [workspace, state] = await Promise.all([getWorkspace(db), getReleaseState(db)]);
  const version = workspace?.latestRelease ?? null;
  const sha256 = state?.latestSha256 ?? null;
  if (version === null || sha256 === null || workspace?.releaseCheckedAt == null) return null;
  return { version, sha256, notesUrl: notesUrl(version), checkedAt: workspace.releaseCheckedAt };
}

/**
 * Asks GitHub again when forced or when the stored answer is older than `LATEST_TTL_MS`, and stores a good answer.
 * A failed look keeps the stored one.
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
  await updateWorkspace(input.db, {
    patch: { latestRelease: result.release.version, releaseCheckedAt: input.now },
    now: input.now,
  });
  await updateReleaseState(input.db, { latestSha256: result.release.sha256 });
  return { latest: { ...result.release, checkedAt: input.now }, checkError: null };
}

export function isAvailable(status: ReleaseStatus, latest: UpdatesView["latest"]): boolean {
  if (latest === null || status.installed === null) return false;
  return newer(latest.version, status.installed.version);
}

/**
 * Starting an update needs the pin the owner saw to be the newest release this admin found, not just any pin the
 * browser sends.
 */
export async function startUpdate(input: { db: Db; hub: HubSetup; pin: ReleasePin }) {
  const latest = await storedLatest(input.db);
  if (latest === null || latest.version !== input.pin.version || latest.sha256 !== input.pin.sha256) {
    return { ok: false as const, message: "The newest release changed since you looked. Check again, then confirm." };
  }
  return input.hub.startUpdate(input.pin);
}

/** True once a "republish all" started after `since` has gone live. */
export async function republishedSince(db: Db, since: number): Promise<boolean> {
  const done = await listDeployments(db, { worker: "sites", status: "done" });
  return done.some((row) => row.kind === "update" && row.host === null && row.startedAt >= since);
}

/**
 * What still stands between the running change and its end, or null. The new admin has to answer this request
 * itself (a dev build without a release says nothing about itself) and every page must be published again by it.
 */
export async function finishBlocker(input: {
  db: Db;
  change: ReleaseChange | null;
  running: string | null;
}): Promise<string | null> {
  const { change } = input;
  if (change === null) return "No update is running.";
  if (change.finished) return null;
  if (input.running !== null && input.running !== change.pin.version) {
    return `The admin still runs ${input.running}. Wait a few seconds for ${change.pin.version} to take over, then retry.`;
  }
  if (!(await republishedSince(input.db, change.startedAt))) {
    return `Every page has to be published again with ${change.pin.version} first.`;
  }
  return null;
}
