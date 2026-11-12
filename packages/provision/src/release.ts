// The release format: `release.json` and the packs it lists. Built by `scripts/build-release.ts` on a tag, read by
// the installer (and later the admin's Update). A pack is the files of one group, concatenated in path order:
// GitHub Releases hold flat files, and one download per group keeps a step inside 50 subrequests.
import { z } from "zod";
import { StepFailedError } from "./steps";

export const RELEASE_FORMAT = 1;

export const PACKS = ["catalog", "admin-modules", "admin-assets", "migrations"] as const;
export type PackName = (typeof PACKS)[number];

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

const fileSchema = z.object({
  pack: z.enum(PACKS),
  /** Where the file is served (`/catalog/…`, `/admin/_assets/…`), the module name, or the migration's file name. */
  path: z.string().min(1).max(512),
  offset: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  sha256,
  /** `contentHash(path, bytes)` of `@deparked/hosting`: the asset manifest hash and the `site_files` hash. */
  hash: z.string().regex(/^[0-9a-f]{32}$/),
  contentType: z.string().min(1).max(128),
});

const releaseSchema = z.object({
  format: z.literal(RELEASE_FORMAT),
  version,
  /** The oldest installer that can install this release. */
  minInstallerVersion: version,
  /** Base URL that serves each catalog file at `<base><path>` without a redirect: the admin's `RELEASE_FILES_URL`. */
  catalogFilesUrl: z.url({ protocol: /^https?$/ }),
  tokenPermissions: z.array(z.object({ key: z.string(), type: z.enum(["read", "edit"]) })),
  packs: z.array(z.object({ name: z.enum(PACKS), size: z.number().int().nonnegative(), sha256 })),
  workers: z.object({
    sites: z.object({ compatibilityDate: z.string(), headers: z.string() }),
    admin: z.object({
      mainModule: z.string(),
      compatibilityDate: z.string(),
      compatibilityFlags: z.array(z.string()),
    }),
  }),
  files: z.array(fileSchema),
});

export type Release = z.infer<typeof releaseSchema>;
export type ReleaseFile = z.infer<typeof fileSchema>;

/** A release file that is missing, altered or malformed. The install stops; retrying downloads it again. */
export class ReleaseError extends StepFailedError {
  override readonly name = "ReleaseError";
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Checks `release.json` against the SHA-256 the installer pins, then its shape: every pack is tiled exactly by
 * its files, in order, so checking each file's hash checks every byte of the pack.
 */
export async function parseRelease(bytes: Uint8Array, pinnedSha256: string): Promise<Release> {
  if ((await sha256Hex(bytes)) !== pinnedSha256.toLowerCase()) {
    throw new ReleaseError(
      "The downloaded release.json is not the one this installer trusts. Nothing was installed from it.",
    );
  }
  let parsed: Release;
  try {
    parsed = releaseSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new ReleaseError("release.json matches its checksum but cannot be read: the release is broken.");
  }
  for (const pack of parsed.packs) {
    let offset = 0;
    for (const file of parsed.files.filter((entry) => entry.pack === pack.name)) {
      if (file.offset !== offset) throw new ReleaseError(`release.json lists ${file.path} at the wrong place.`);
      offset += file.size;
    }
    if (offset !== pack.size) throw new ReleaseError(`release.json does not account for every byte of ${pack.name}.`);
  }
  return parsed;
}

export function packFileName(release: Pick<Release, "version">, pack: PackName): string {
  return `deparked-${release.version}-${pack}.pack`;
}

export interface VerifiedFile extends ReleaseFile {
  content: Uint8Array;
}

/**
 * Checks a downloaded pack's size and SHA-256 against `release.json`, then splits it into its files. The files
 * tile the pack (`parseRelease`), so the one hash covers every byte of every file: one digest instead of one per
 * file keeps the admin's 2 MB inside Workers Free's CPU time.
 */
export async function unpack(release: Release, pack: PackName, bytes: Uint8Array): Promise<VerifiedFile[]> {
  const listed = release.packs.find((entry) => entry.name === pack);
  if (listed === undefined) throw new ReleaseError(`This release has no ${pack} files.`);
  const name = packFileName(release, pack);
  if (bytes.length !== listed.size || (await sha256Hex(bytes)) !== listed.sha256) {
    throw new ReleaseError(
      `${name} does not match release.json: the download was cut short or altered. Retry; if it fails again, the release is broken.`,
    );
  }
  return release.files
    .filter((entry) => entry.pack === pack)
    .map((file) => ({ ...file, content: bytes.subarray(file.offset, file.offset + file.size) }));
}

/** Where the installer gets the release from. Every value it returns is already verified. */
export interface ReleaseSource {
  manifest(): Promise<Release>;
  pack(name: PackName): Promise<VerifiedFile[]>;
}

/** A `ReleaseSource` over a fetch of `<baseUrl>/<file name>`. Each pack is downloaded at most once per source. */
export function releaseFromUrl(input: {
  baseUrl: string;
  pinnedSha256: string;
  fetch?: (url: string) => Promise<Response>;
}): ReleaseSource & { downloads: number } {
  const fetchFile = input.fetch ?? ((url: string) => fetch(url));
  let manifest: Promise<Release> | undefined;
  const packs = new Map<PackName, Promise<VerifiedFile[]>>();
  const source = {
    downloads: 0,
    async download(name: string): Promise<Uint8Array> {
      source.downloads += 1;
      let response: Response;
      try {
        response = await fetchFile(`${input.baseUrl}/${name}`);
      } catch {
        throw new ReleaseError(`Could not download ${name}: no answer. Check your connection, then retry.`);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ReleaseError(`Could not download ${name} (status ${response.status}). Retry in a moment.`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    manifest() {
      manifest ??= source.download("release.json").then((bytes) => parseRelease(bytes, input.pinnedSha256));
      manifest.catch(() => {
        manifest = undefined;
      });
      return manifest;
    },
    pack(name: PackName) {
      let files = packs.get(name);
      if (files === undefined) {
        files = source
          .manifest()
          .then(async (release) => unpack(release, name, await source.download(packFileName(release, name))));
        files.catch(() => packs.delete(name));
        packs.set(name, files);
      }
      return files;
    },
  };
  return source;
}

/** True when `installer` is at least `minimum` (both plain `x.y.z`; a pre-release counts as its version). */
export function versionAtLeast(installer: string, minimum: string): boolean {
  const parts = (value: string) => value.split("-")[0]?.split(".").map(Number) ?? [];
  const [a, b] = [parts(installer), parts(minimum)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
