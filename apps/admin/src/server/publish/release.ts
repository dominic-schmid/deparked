import { PublishFailure } from "./files";

/**
 * Returns the bytes of one catalog file of the installed release, by its served path (`/catalog/...`). `size` is
 * what the manifest lists: a larger file is refused before it is read in full.
 */
export type FetchReleaseFile = (path: string, size: number) => Promise<Uint8Array>;

type Fetch = (url: string, init: { redirect: RequestRedirect }) => Promise<Response>;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * `RELEASE_FILES_URL` as a base to append served paths to: `https://`, or `http://` on this machine only, without
 * credentials, query or fragment. Null for anything else.
 */
export function parseReleaseBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!secure || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function tooLarge(path: string): PublishFailure {
  return new PublishFailure("hosting", `The release's copy of ${path} is larger than the file that was installed.`);
}

async function readAtMost(path: string, response: Response, size: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > size) throw tooLarge(path);
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const content = new Uint8Array(size);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return content.subarray(0, length);
    if (length + value.length > size) {
      await reader.cancel();
      throw tooLarge(path);
    }
    content.set(value, length);
    length += value.length;
  }
}

/**
 * Downloads catalog files from wherever the release keeps them: `baseUrl` + the served path, no redirects. The
 * publish checks every file against the hash in the manifest before it is sent on, so this does not have to trust
 * the source.
 */
export function createReleaseFileFetcher(options: {
  /** From `parseReleaseBaseUrl`. Null when no release is installed (local dev): every request then fails readably. */
  baseUrl: string | null;
  fetch?: Fetch;
}): FetchReleaseFile {
  const fetchFile: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  return async (path, size) => {
    if (options.baseUrl === null) {
      throw new PublishFailure(
        "invalid",
        `Cloudflare asked for ${path} again, but no release is installed to get it from.`,
      );
    }
    let response: Response;
    try {
      // workerd rejects `redirect: "error"`; with "manual" a redirect is a 3xx, refused below like any non-200.
      response = await fetchFile(`${options.baseUrl}${path}`, { redirect: "manual" });
    } catch {
      throw new PublishFailure("hosting", `Could not download ${path} from the release (no answer).`);
    }
    if (!response.ok) {
      throw new PublishFailure("hosting", `Could not download ${path} from the release (status ${response.status}).`);
    }
    return readAtMost(path, response, size);
  };
}
