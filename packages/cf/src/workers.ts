import { z } from "zod";
import { CloudflareApiError, type Http } from "./http";

export type WorkerBinding =
  | { type: "d1"; name: string; databaseId: string }
  | { type: "send_email"; name: string; destinationAddress?: string; allowedDestinationAddresses?: string[] }
  | { type: "assets"; name: string }
  | { type: "plain_text"; name: string; text: string }
  | { type: "secret_text"; name: string; text: string };

export interface AssetManifestEntry {
  /** 32 hex characters, see `hashAsset`. */
  hash: string;
  size: number;
}

/** Every file of the Worker, keyed by its path with a leading slash (`/sites/example.com/index.html`). */
export type AssetManifest = Record<string, AssetManifestEntry>;

export interface AssetsConfig {
  html_handling?: "auto-trailing-slash" | "force-trailing-slash" | "drop-trailing-slash" | "none";
  not_found_handling?: "none" | "404-page" | "single-page-application";
  run_worker_first?: boolean | string[];
}

export interface WorkerModule {
  name: string;
  content: string | Uint8Array;
  /** Defaults to `application/javascript+module`. */
  type?: string;
}

export interface WorkerUpload {
  /** Omit for a Worker that only serves static assets. */
  mainModule?: string;
  modules?: WorkerModule[];
  compatibilityDate: string;
  compatibilityFlags?: string[];
  bindings?: WorkerBinding[];
  /**
   * Binding types carried over from the previous version when not listed in `bindings`.
   * Default `["secret_text", "secret_key"]`, so secrets set earlier (API token, session key, Turnstile
   * secrets) survive a code update. Pass `[]` to drop every binding that is not listed.
   */
  keepBindings?: string[];
  /** The completion token of an assets upload, with the serving config. */
  assets?: { jwt: string; config?: AssetsConfig };
  /** Reuse the previous version's assets instead of a completion token. */
  keepAssets?: boolean;
}

const DEFAULT_KEEP_BINDINGS = ["secret_text", "secret_key"];

const sessionSchema = z.object({
  jwt: z.string(),
  buckets: z
    .array(z.array(z.string()))
    .nullish()
    .transform((buckets) => buckets ?? []),
});

const bucketUploadSchema = z
  .object({ jwt: z.string().optional() })
  .nullish()
  .transform((result) => result?.jwt);

const scriptSchema = z.object({
  id: z.string().optional(),
  etag: z.string().optional(),
  has_assets: z.boolean().optional(),
});

const versionSchema = z.object({
  id: z.string(),
  number: z.number().optional(),
  metadata: z.object({ created_on: z.string().optional() }).optional(),
});
export type WorkerVersion = z.infer<typeof versionSchema>;

const deploymentSchema = z.object({
  id: z.string(),
  created_on: z.string().optional(),
  versions: z.array(z.object({ version_id: z.string(), percentage: z.number() })),
});
export type WorkerDeployment = z.infer<typeof deploymentSchema>;

const settingsSchema = z.object({
  bindings: z
    .array(z.object({ name: z.string(), type: z.string() }))
    .optional()
    .transform((bindings) => bindings ?? []),
  compatibility_date: z.string().optional(),
  compatibility_flags: z.array(z.string()).optional(),
});
/** Binding names and types only: Cloudflare never returns a secret's value. */
export type WorkerSettings = z.infer<typeof settingsSchema>;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * The hash Cloudflare's own tooling uses in an asset manifest: the first 32 hex characters of
 * SHA-256 over the base64 content plus the file extension. Any stable 32-hex hash works; using this one
 * keeps manifests comparable with Wrangler's.
 */
export async function hashAsset(path: string, content: Uint8Array): Promise<string> {
  const extension = /\.([^./]+)$/.exec(path)?.[1] ?? "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(toBase64(content) + extension));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function bindingJson(binding: WorkerBinding): Record<string, unknown> {
  switch (binding.type) {
    case "d1":
      return { type: "d1", name: binding.name, id: binding.databaseId, database_id: binding.databaseId };
    case "send_email":
      return {
        type: "send_email",
        name: binding.name,
        ...(binding.destinationAddress === undefined ? {} : { destination_address: binding.destinationAddress }),
        ...(binding.allowedDestinationAddresses === undefined
          ? {}
          : { allowed_destination_addresses: binding.allowedDestinationAddresses }),
      };
    default:
      return { ...binding };
  }
}

export function workersApi(http: Http) {
  const account = `/accounts/${http.accountId}/workers`;
  const script = (name: string) => `${account}/scripts/${name}`;

  function uploadForm(upload: WorkerUpload, allowAssets: boolean): FormData {
    for (const binding of upload.bindings ?? []) {
      if (binding.type === "secret_text") http.hide(binding.text);
    }
    const metadata: Record<string, unknown> = {
      compatibility_date: upload.compatibilityDate,
      bindings: (upload.bindings ?? []).map(bindingJson),
      keep_bindings: upload.keepBindings ?? DEFAULT_KEEP_BINDINGS,
    };
    if (upload.mainModule !== undefined) metadata.main_module = upload.mainModule;
    if (upload.compatibilityFlags !== undefined) metadata.compatibility_flags = upload.compatibilityFlags;
    if (allowAssets && upload.assets !== undefined) metadata.assets = upload.assets;
    if (allowAssets && upload.keepAssets === true) metadata.keep_assets = true;
    const form = new FormData();
    form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    for (const module of upload.modules ?? []) {
      const type = module.type ?? "application/javascript+module";
      form.set(module.name, new Blob([module.content as BlobPart], { type }), module.name);
    }
    return form;
  }

  const api = {
    /**
     * Step 1 of a publish: send the full manifest. `buckets` lists only the hashes Cloudflare doesn't have yet.
     * When `buckets` is empty, `jwt` already is the completion token.
     */
    async createAssetsUploadSession(scriptName: string, manifest: AssetManifest) {
      const session = await http.request(
        {
          call: "start assets upload",
          method: "POST",
          path: `${script(scriptName)}/assets-upload-session`,
          json: { manifest },
        },
        sessionSchema,
      );
      http.hide(session.jwt);
      return session;
    },

    /**
     * Step 2: upload one bucket, authenticated with the session token (not the API token).
     * Resolves with the completion token once Cloudflare has every file of the manifest, else undefined.
     */
    async uploadAssetsBucket(
      sessionJwt: string,
      files: { hash: string; content: Uint8Array; contentType: string }[],
    ): Promise<string | undefined> {
      const form = new FormData();
      for (const file of files) {
        form.set(file.hash, new Blob([toBase64(file.content)], { type: file.contentType }), file.hash);
      }
      const completion = await http.request(
        {
          call: "upload assets",
          method: "POST",
          path: `${account}/assets/upload`,
          query: { base64: true },
          form,
          bearer: sessionJwt,
        },
        bucketUploadSchema,
      );
      if (completion !== undefined) http.hide(completion);
      return completion;
    },

    /**
     * Steps 1 and 2 together. `read` is called only for the files Cloudflare asks for, so the caller must be
     * able to reproduce any file of the manifest. Requests: 1 + one per bucket (before retries).
     */
    async uploadAssets(input: {
      scriptName: string;
      manifest: AssetManifest;
      read: (path: string) => Promise<{ content: Uint8Array; contentType: string }>;
    }): Promise<{ completionJwt: string; uploaded: string[] }> {
      const session = await api.createAssetsUploadSession(input.scriptName, input.manifest);
      const pathByHash = new Map(Object.entries(input.manifest).map(([path, entry]) => [entry.hash, path]));
      let completionJwt = session.buckets.length === 0 ? session.jwt : undefined;
      const uploaded: string[] = [];
      for (const bucket of session.buckets) {
        const files = [];
        for (const hash of bucket) {
          const path = pathByHash.get(hash);
          if (path === undefined) {
            throw new CloudflareApiError({
              call: "upload assets",
              status: 200,
              detail: "Cloudflare asked for a file that is not in the manifest",
            });
          }
          files.push({ hash, ...(await input.read(path)) });
          uploaded.push(path);
        }
        completionJwt = (await api.uploadAssetsBucket(session.jwt, files)) ?? completionJwt;
      }
      if (completionJwt === undefined) {
        throw new CloudflareApiError({
          call: "upload assets",
          status: 200,
          detail: "every bucket was uploaded but no completion token came back",
        });
      }
      return { completionJwt, uploaded };
    },

    /**
     * Creates or replaces the Worker and deploys it at once (step 3 of a publish; also the first install,
     * because a version can't be uploaded to a Worker that doesn't exist yet). 1 request.
     */
    uploadScript(scriptName: string, upload: WorkerUpload) {
      return http.request(
        {
          call: `upload Worker ${scriptName}`,
          method: "PUT",
          path: script(scriptName),
          form: uploadForm(upload, true),
        },
        scriptSchema,
      );
    },

    /**
     * Uploads a new version of an existing Worker without deploying it; `deployVersion` makes it live.
     * Used by Update so a failed health check can roll back. Assets are not sent here: use `uploadScript`
     * for a Worker with assets.
     */
    uploadVersion(scriptName: string, upload: WorkerUpload): Promise<WorkerVersion> {
      return http.request(
        {
          call: `upload version of Worker ${scriptName}`,
          method: "POST",
          path: `${script(scriptName)}/versions`,
          form: uploadForm(upload, false),
        },
        versionSchema,
      );
    },

    /** Newest first. One request (the newest page). */
    async listVersions(scriptName: string): Promise<WorkerVersion[]> {
      const result = await http.request(
        { call: "list Worker versions", method: "GET", path: `${script(scriptName)}/versions` },
        z.object({ items: z.array(versionSchema) }),
      );
      return result.items;
    },

    /** Newest first; the first entry is what serves traffic now. */
    async listDeployments(scriptName: string): Promise<WorkerDeployment[]> {
      const result = await http.request(
        { call: "list Worker deployments", method: "GET", path: `${script(scriptName)}/deployments` },
        z.object({ deployments: z.array(deploymentSchema) }),
      );
      return result.deployments;
    },

    /** Sends all traffic to one version. Deploying a previous version is the rollback. */
    deployVersion(scriptName: string, versionId: string, message?: string): Promise<WorkerDeployment> {
      const json = {
        strategy: "percentage",
        versions: [{ version_id: versionId, percentage: 100 }],
        ...(message === undefined ? {} : { annotations: { "workers/message": message } }),
      };
      return http.request(
        { call: `deploy Worker ${scriptName}`, method: "POST", path: `${script(scriptName)}/deployments`, json },
        deploymentSchema,
      );
    },

    async putSecret(scriptName: string, name: string, text: string): Promise<void> {
      http.hide(text);
      await http.request(
        {
          call: `set Worker secret ${name}`,
          method: "PUT",
          path: `${script(scriptName)}/secrets`,
          json: { name, text, type: "secret_text" },
        },
        z.unknown(),
      );
    },

    async deleteSecret(scriptName: string, name: string): Promise<void> {
      await http.request(
        { call: `delete Worker secret ${name}`, method: "DELETE", path: `${script(scriptName)}/secrets/${name}` },
        z.unknown(),
      );
    },

    /** Turns `<script>.<account>.workers.dev` on or off. */
    setSubdomain(scriptName: string, enabled: boolean): Promise<{ enabled: boolean }> {
      return http.request(
        {
          call: "set workers.dev address",
          method: "POST",
          path: `${script(scriptName)}/subdomain`,
          json: { enabled, previews_enabled: false },
        },
        z.object({ enabled: z.boolean() }),
      );
    },

    /** Null when the Worker doesn't exist. */
    getSettings(scriptName: string): Promise<WorkerSettings | null> {
      return http.requestOrNull(
        { call: "read Worker settings", method: "GET", path: `${script(scriptName)}/settings` },
        settingsSchema,
      );
    },
  };
  return api;
}
