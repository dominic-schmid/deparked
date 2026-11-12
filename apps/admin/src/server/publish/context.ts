import { env } from "cloudflare:workers";
import { createDb, getWorkspace } from "@deparked/db";
import { catalog } from "@deparked/templates/catalog";
import sitesHeaders from "../../../../sites/public/_headers?raw";
import { createHosting } from "../hosting";
import type * as pipeline from "./pipeline";
import { createReleaseFileFetcher, parseReleaseBaseUrl } from "./release";

// Its own module, not in `functions.ts`: an exported plain function there would pull `cloudflare:workers` into
// the client bundle of every server function file that imports it.
export async function publishContext(): Promise<pipeline.PublishContext> {
  const db = createDb(env.DB);
  const workspace = await getWorkspace(db);
  return {
    db,
    hosting: createHosting({ accountId: workspace?.cfAccountId ?? null }),
    now: Date.now,
    catalog,
    headers: sitesHeaders,
    release: workspace?.installedRelease ?? null,
    fetchReleaseFile: createReleaseFileFetcher({
      baseUrl: parseReleaseBaseUrl((env as unknown as Record<string, unknown>).RELEASE_FILES_URL),
    }),
  };
}
