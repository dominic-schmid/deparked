import { CONFIG_VERSION, migrateConfig } from "@deparked/config";
import { type Db, getConfig, getDomain, type NewSiteFile } from "@deparked/db";
import { contentHash } from "@deparked/hosting";
import { type Catalog, render, renderPlaceholder, type SiteFiles } from "@deparked/templates";

export type FailureReason = "credentials-rejected" | "lock-lost" | "invalid" | "hosting" | "unexpected";

/** A publish that cannot go on. `message` is shown to the owner as it is: plain words, no secrets. */
export class PublishFailure extends Error {
  override readonly name = "PublishFailure";
  readonly reason: FailureReason;

  constructor(reason: FailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export type HostFile = NewSiteFile & { content: Uint8Array };

/** One host's pages, rendered. No files: the domain is turned off or removed and serves nothing. */
export type HostBuild = {
  host: string;
  files: HostFile[];
  /** The draft these files were rendered from, normalised. Only set for a draft publish. */
  published?: { json: string; schemaVersion: number };
  /** True when the files come from the live config again (an update, or templates that changed). */
  rerendered?: boolean;
};

const CONTENT_TYPES: Record<keyof SiteFiles, string> = {
  "index.html": "text/html; charset=utf-8",
  "robots.txt": "text/plain; charset=utf-8",
  "sitemap.xml": "application/xml; charset=utf-8",
};

export function sitePath(host: string, name: string): string {
  return `/sites/${host}/${name}`;
}

async function toHostFiles(host: string, files: SiteFiles): Promise<HostFile[]> {
  const encoder = new TextEncoder();
  return Promise.all(
    (Object.keys(CONTENT_TYPES) as (keyof SiteFiles)[]).map(async (name) => {
      const path = sitePath(host, name);
      const content = encoder.encode(files[name]);
      return {
        path,
        hash: await contentHash(path, content),
        size: content.length,
        contentType: CONTENT_TYPES[name],
        content,
      };
    }),
  );
}

/**
 * Renders what `host` should serve. `draft`: the saved draft, which must exist and be valid. `live`: the live
 * config again, or the placeholder for a domain that was never published. A domain that is off, removed or
 * unknown gets no files, whatever the source.
 */
export async function buildHost(
  input: { db: Db; catalog: Catalog },
  host: string,
  source: "draft" | "live",
): Promise<HostBuild> {
  const domain = await getDomain(input.db, host);
  if (domain === undefined || domain.status === "off" || domain.status === "removed") return { host, files: [] };

  const stored = await getConfig(input.db, host);
  const json = source === "draft" ? stored?.draftJson : stored?.liveJson;
  if (json === undefined || json === null) {
    if (source === "draft") throw new PublishFailure("invalid", `${host} has no saved design to publish yet.`);
    return { host, files: await toHostFiles(host, renderPlaceholder(host)) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = undefined;
  }
  const result = migrateConfig(parsed);
  if (!result.ok) {
    const [field, problem] = Object.entries(result.errors)[0] ?? ["form", "It can't be read."];
    throw new PublishFailure("invalid", `The design of ${host} can't be published (${field}): ${problem}`);
  }
  if (domain.turnstileWidgetId === null) {
    throw new PublishFailure("invalid", `${host} has no bot check yet. Finish setting the domain up, then publish.`);
  }
  const files = render(result.config, host, {
    catalog: input.catalog,
    sitekey: domain.turnstileWidgetId,
    ...(domain.analyticsBeaconToken === null ? {} : { beaconToken: domain.analyticsBeaconToken }),
  });
  const built = await toHostFiles(host, files);
  return source === "draft"
    ? { host, files: built, published: { json: JSON.stringify(result.config), schemaVersion: CONFIG_VERSION } }
    : { host, files: built, rerendered: true };
}
