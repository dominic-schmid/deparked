import {
  type CloudflareClient,
  createCloudflareClient,
  type DestinationAddress,
  type FetchLike,
  verifyTurnstile,
  type WorkerRoute,
} from "@deparked/cf";
import {
  type AnalyticsReport,
  assertPublishFiles,
  type BotCheckResult,
  DEFAULT_MAX_UPLOAD_BATCHES,
  type HostingAdapter,
  HostingError,
  type HostingRoute,
  type NotifyAddress,
  notificationSender,
  type RouteTarget,
} from "@deparked/hosting";
import { cloudflare } from "./errors";
import { assertAddress, buildMimeMessage } from "./mime";

/** The Worker's `send_email` binding (`env.EMAIL`). */
export interface SendEmailBinding {
  send(message: unknown): Promise<unknown>;
}

/** `EmailMessage` from `cloudflare:email`. Passed in because that module only exists inside workerd. */
export type EmailMessageConstructor = new (from: string, to: string, raw: string) => unknown;

type Connection =
  | { client: CloudflareClient }
  | {
      /** The owner's API token. Never logged; errors are redacted by the client. */
      token: string;
      accountId: string;
      /** Defaults to Cloudflare's API. The E2E harness points this at the mock server. */
      baseUrl?: string;
    };

export type CloudflareHostingOptions = Connection & {
  /** The assets-only Worker that serves every lander (`deparked-sites`). */
  sitesScriptName: string;
  /** The admin Worker (`deparked-admin`). Only needed to add or recognise routes to the admin. */
  adminScriptName?: string;
  /** Without it `sendNotification` fails with a readable error; everything else works. */
  email?: { binding: SendEmailBinding; EmailMessage: EmailMessageConstructor };
  /**
   * Reads a Turnstile widget secret by the name of the Worker secret that holds it (`(name) => env[name]`).
   * Only called for names matching `BOT_CHECK_SECRET_REF`, so a `secretRef` can never read another secret.
   */
  getSecret(ref: string): string | undefined | Promise<string | undefined>;
  /** Used for the API client (with `token`) and for the Turnstile check. */
  fetch?: FetchLike;
  /** Defaults to Cloudflare's siteverify endpoint. */
  botCheckUrl?: string;
  /** Compatibility date of the pages Worker. Default `SITES_COMPATIBILITY_DATE`. */
  compatibilityDate?: string;
  now?: () => Date;
};

export const SITES_COMPATIBILITY_DATE = "2026-11-01";

/**
 * Requests one `publish` call makes besides the upload batches: start the upload session, upload the Worker
 * with its assets (which deploys it), read the new version id. So a publish is `3 + batches` requests before
 * retries, and a call that returns `done: false` is `1 + maxUploadBatches`. Workers Free allows 50 per request.
 * A batch is one of Cloudflare's buckets, or a part of one when `maxFilesPerUpload` is smaller: the docs say a
 * bucket's files "should be uploaded together", and Cloudflare keeps the files it got, so the rest come later.
 */
export const PUBLISH_FIXED_REQUESTS = 3;

/**
 * The naming rule for Turnstile widget secrets (`turnstile_widgets.secret_name`): `TURNSTILE_SECRET_<id>`.
 * Provisioning must store them under such a name; `verifyBotCheck` answers `not-configured` for any other.
 */
export const BOT_CHECK_SECRET_REF = /^TURNSTILE_SECRET_[A-Za-z0-9_]+$/;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day, not just the shape: `2026-13-45` and `2026-02-30` are refused. */
function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function toNotifyAddress(address: DestinationAddress): NotifyAddress {
  return {
    id: address.id,
    email: address.email,
    verified: address.verifiedAt !== null,
    verifiedAt: address.verifiedAt,
  };
}

const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function createCloudflareHosting(options: CloudflareHostingOptions): HostingAdapter {
  const client =
    "client" in options
      ? options.client
      : createCloudflareClient({
          token: options.token,
          accountId: options.accountId,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        });
  const sites = options.sitesScriptName;
  const now = options.now ?? (() => new Date());

  function scriptOf(target: RouteTarget): string {
    if (target === "sites") return sites;
    if (options.adminScriptName === undefined) {
      throw new HostingError("invalid-input", "Routes to the admin need the admin Worker's name.");
    }
    return options.adminScriptName;
  }

  function toRoute(route: WorkerRoute): HostingRoute {
    const target =
      route.script === sites
        ? "sites"
        : route.script !== undefined && route.script === options.adminScriptName
          ? "admin"
          : "other";
    return { id: route.id, pattern: route.pattern, target };
  }

  return {
    async publish(input) {
      assertPublishFiles(input.files);
      const before = client.requestCount;
      const manifest = Object.fromEntries(input.files.map((file) => [file.path, { hash: file.hash, size: file.size }]));
      const fileByHash = new Map(input.files.map((file) => [file.hash, file]));

      const session = await cloudflare(() => client.workers.createAssetsUploadSession(sites, manifest));
      const perUpload = input.maxFilesPerUpload ?? Number.POSITIVE_INFINITY;
      const batches = session.buckets.flatMap((bucket) => {
        const parts: string[][] = [];
        for (let index = 0; index < bucket.length; index += perUpload)
          parts.push(bucket.slice(index, index + perUpload));
        return parts;
      });
      const sending = batches.slice(0, input.maxUploadBatches ?? DEFAULT_MAX_UPLOAD_BATCHES);
      let completion = session.buckets.length === 0 ? session.jwt : undefined;
      const uploaded: string[] = [];
      for (const hashes of sending) {
        const batch: { hash: string; content: Uint8Array; contentType: string }[] = [];
        const paths: string[] = [];
        for (const hash of hashes) {
          const file = fileByHash.get(hash);
          if (file === undefined) {
            throw new HostingError("failed", "Cloudflare asked for a file that is not part of this publish.");
          }
          const content = await input.getContent(file.path);
          if (content.length !== file.size) {
            throw new HostingError("invalid-input", `Cannot publish ${file.path}: its content is not the size listed.`);
          }
          batch.push({ hash, content, contentType: file.contentType });
          paths.push(file.path);
        }
        completion = (await cloudflare(() => client.workers.uploadAssetsBucket(session.jwt, batch))) ?? completion;
        uploaded.push(...paths);
      }

      if (sending.length < batches.length) {
        const requested = session.buckets.reduce((sum, bucket) => sum + bucket.length, 0);
        return { done: false, uploaded, pending: requested - uploaded.length, requests: client.requestCount - before };
      }
      if (completion === undefined) {
        throw new HostingError("failed", "Cloudflare took every file but did not confirm the upload. Publish again.");
      }
      const assets = {
        jwt: completion,
        config: {
          html_handling: "none",
          not_found_handling: "none",
          ...(input.headers === undefined ? {} : { _headers: input.headers }),
        } as const,
      };
      const deployments = await cloudflare(async () => {
        await client.workers.uploadScript(sites, {
          compatibilityDate: options.compatibilityDate ?? SITES_COMPATIBILITY_DATE,
          assets,
        });
        return client.workers.listDeployments(sites);
      });
      const versionId = deployments[0]?.versions[0]?.version_id;
      if (versionId === undefined) {
        throw new HostingError("failed", "The pages were published, but Cloudflare did not report the new version.");
      }
      return { done: true, versionId, uploaded, requests: client.requestCount - before };
    },

    async rollback(versionId) {
      await cloudflare(() => client.workers.deployVersion(sites, versionId, "Deparked rollback"));
      return { versionId };
    },

    async listVersions(listOptions) {
      const [versions, deployments] = await cloudflare(() =>
        Promise.all([client.workers.listVersions(sites), client.workers.listDeployments(sites)]),
      );
      const live = deployments[0]?.versions[0]?.version_id;
      return versions.slice(0, listOptions?.limit ?? 20).map((version) => ({
        id: version.id,
        createdAt: version.metadata?.created_on ?? null,
        live: version.id === live,
      }));
    },

    async verifyBotCheck(input): Promise<BotCheckResult> {
      if (input.token.trim() === "") return { ok: false, reason: "rejected" };
      if (!BOT_CHECK_SECRET_REF.test(input.secretRef)) return { ok: false, reason: "not-configured" };
      const secret = await options.getSecret(input.secretRef);
      if (secret === undefined || secret === "") return { ok: false, reason: "not-configured" };
      const result = await cloudflare(() =>
        verifyTurnstile({
          secret,
          response: input.token,
          expectedHostname: input.host,
          ...(input.remoteIp === undefined ? {} : { remoteIp: input.remoteIp }),
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          ...(options.botCheckUrl === undefined ? {} : { url: options.botCheckUrl }),
        }),
      );
      if (result.success) return { ok: true };
      if (result.errorCodes.includes("hostname-mismatch")) return { ok: false, reason: "wrong-host" };
      const secretRefused = result.errorCodes.some((code) => code.endsWith("-input-secret"));
      return { ok: false, reason: secretRefused ? "not-configured" : "rejected" };
    },

    async sendNotification(message) {
      if (options.email === undefined) {
        throw new HostingError("failed", "The email was not sent: this Worker has no email binding.");
      }
      const from = assertAddress(notificationSender(message.senderHost), "sender address");
      const to = assertAddress(message.to, "notify address");
      const raw = buildMimeMessage({
        from: { email: from, name: message.fromName },
        to,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        date: now(),
        messageId: `${crypto.randomUUID()}@${message.senderHost}`,
      });
      try {
        await options.email.binding.send(new options.email.EmailMessage(from, to, raw));
      } catch (cause) {
        // The binding's own message can quote addresses, so it stays in `cause` and out of the UI text.
        throw new HostingError(
          "failed",
          "Cloudflare did not accept the email. Check that the notify address is verified and that the sending domain has Email Routing on.",
          { cause },
        );
      }
    },

    async readAnalytics(query): Promise<AnalyticsReport> {
      if (!isDate(query.from) || !isDate(query.to) || query.from > query.to) {
        throw new HostingError("invalid-input", "The date range for the statistics is not valid.");
      }
      if (query.sites.length === 0) return { visitsByDay: [], referrers: [], countries: [], totalVisits: 0 };
      const report = await cloudflare(() =>
        client.analytics.report({ siteTags: query.sites.map((site) => site.siteId), from: query.from, to: query.to }),
      );
      return {
        visitsByDay: report.visitsByDay,
        referrers: report.referrers,
        countries: report.countries,
        totalVisits: report.visitsByDay.reduce((sum, row) => sum + row.visits, 0),
      };
    },

    notifyAddresses: {
      async list() {
        return (await cloudflare(() => client.email.listAddresses())).map(toNotifyAddress);
      },

      async add(input) {
        const email = assertAddress(input.trim().toLowerCase(), "notify address");
        try {
          return toNotifyAddress(await cloudflare(() => client.email.createAddress(email)));
        } catch (error) {
          if (!(error instanceof HostingError) || error.code !== "conflict") throw error;
          const existing = (await cloudflare(() => client.email.listAddresses())).find((address) =>
            sameEmail(address.email, email),
          );
          if (existing === undefined) throw error;
          return toNotifyAddress(existing);
        }
      },

      async remove(id) {
        try {
          await cloudflare(() => client.email.deleteAddress(id));
        } catch (error) {
          if (!(error instanceof HostingError) || error.code !== "not-found") throw error;
        }
      },

      async resend(id) {
        const found = (await cloudflare(() => client.email.listAddresses())).find((address) => address.id === id);
        if (found === undefined) throw new HostingError("not-found", "This notify address no longer exists.");
        if (found.verifiedAt !== null) return toNotifyAddress(found);
        // Cloudflare has no "send again": deleting and re-adding a pending address is what sends a new mail.
        return toNotifyAddress(
          await cloudflare(async () => {
            await client.email.deleteAddress(found.id);
            return client.email.createAddress(found.email);
          }),
        );
      },
    },

    routes: {
      async list(domainId) {
        return (await cloudflare(() => client.zones.listRoutes(domainId))).map(toRoute);
      },

      async add(domainId, route) {
        const script = scriptOf(route.target);
        const existing = (await cloudflare(() => client.zones.listRoutes(domainId))).find(
          (entry) => entry.pattern === route.pattern,
        );
        if (existing !== undefined && existing.script !== script) {
          throw new HostingError("conflict", `The address ${route.pattern} is already used by something else.`);
        }
        if (existing !== undefined) return toRoute(existing);
        return toRoute(await cloudflare(() => client.zones.createRoute(domainId, { pattern: route.pattern, script })));
      },

      async remove(domainId, routeId) {
        const found = (await cloudflare(() => client.zones.listRoutes(domainId))).find((entry) => entry.id === routeId);
        if (found === undefined) throw new HostingError("not-found", "This domain has no such route.");
        if (toRoute(found).target === "other") {
          throw new HostingError("conflict", `The address ${found.pattern} belongs to something else and stays.`);
        }
        await cloudflare(() => client.zones.deleteRoute(domainId, routeId));
      },
    },
  };
}

export { type CloudflareSetupOptions, createCloudflareDomainSetup } from "./setup";
