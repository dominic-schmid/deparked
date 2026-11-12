import { PublishFailure } from "./files";

/** Returns the bytes of one catalog file of the installed release, by its served path (`/catalog/...`). */
export type FetchReleaseFile = (path: string) => Promise<Uint8Array>;

/**
 * Downloads catalog files from wherever the release keeps them: `baseUrl` + the served path. The publish checks
 * every file against the hash in the manifest before it is sent on, so this does not have to trust the source.
 */
export function createReleaseFileFetcher(options: {
  /** Null when no release is installed (local dev): every request then fails with a readable message. */
  baseUrl: string | null;
  fetch?: (url: string) => Promise<Response>;
}): FetchReleaseFile {
  const fetchFile = options.fetch ?? ((url: string) => fetch(url));
  return async (path) => {
    if (options.baseUrl === null) {
      throw new PublishFailure("invalid", `Cloudflare asked for ${path} again, but no release is installed to get it from.`);
    }
    const response = await fetchFile(`${options.baseUrl}${path}`);
    if (!response.ok) {
      throw new PublishFailure("hosting", `Could not download ${path} from the release (status ${response.status}).`);
    }
    return new Uint8Array(await response.arrayBuffer());
  };
}
