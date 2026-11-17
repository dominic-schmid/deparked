import { env } from "cloudflare:workers";
import { createDb, getWorkspace } from "@deparked/db";
import { fetchLatestRelease, releaseLocation } from "./latest";
import { newer, refreshLatest } from "./updates";

/**
 * The newer release for the banner on every screen, or null. Asks GitHub at most once an hour (like Updates does);
 * a failed look shows no banner rather than breaking the page.
 */
export async function readyUpdate(): Promise<string | null> {
  const db = createDb(env.DB);
  try {
    const [{ latest }, workspace] = await Promise.all([
      refreshLatest({
        db,
        now: Date.now(),
        force: false,
        fetchLatest: () => fetchLatestRelease(releaseLocation(env as unknown as Record<string, unknown>)),
      }),
      getWorkspace(db),
    ]);
    const installed = workspace?.installedRelease ?? null;
    return latest !== null && installed !== null && newer(latest.version, installed) ? latest.version : null;
  } catch {
    return null;
  }
}
