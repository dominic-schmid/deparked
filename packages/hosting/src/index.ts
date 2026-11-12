/**
 * The boundary between Deparked and whoever hosts it. The admin, the templates, the config and the database
 * talk to this interface only; each host's implementation is a package of its own.
 * Nothing here reads or writes the database: callers pass what a call needs and store what it returns.
 */

export type HostingErrorCode =
  /** The host refused the stored credentials (or they lack a permission). Show the "token rejected" banner. */
  | "credentials-rejected"
  | "not-found"
  | "conflict"
  /** The caller passed something the host cannot take (a malformed address, a file that changed size). */
  | "invalid-input"
  | "rate-limited"
  /** No answer or a server error on the host's side. Trying again later may work. */
  | "unavailable"
  | "failed";

/**
 * Every failure of an adapter call. `message` is written for the admin UI: plain words, no secrets, no
 * buyer data. The underlying error, if any, is in `cause`.
 */
export class HostingError extends Error {
  override readonly name = "HostingError";
  readonly code: HostingErrorCode;

  constructor(code: HostingErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }

  /** True when the admin should show the "token rejected" banner and offer "Replace token". */
  get credentialsRejected(): boolean {
    return this.code === "credentials-rejected";
  }

  get retryable(): boolean {
    return this.code === "rate-limited" || this.code === "unavailable";
  }
}

/** One file of the published pages, as stored in the publish manifest. */
export interface PublishFile {
  /** Absolute path as served, with a leading slash: `/sites/example.com/index.html`. */
  path: string;
  /** 32 lowercase hex characters that change whenever the content does. See `contentHash`. */
  hash: string;
  /** Size of the content in bytes. */
  size: number;
  contentType: string;
}

export interface PublishInput {
  /** The complete manifest: every file of every domain plus the shared catalog. Files left out are unpublished. */
  files: readonly PublishFile[];
  /**
   * Called only for files the host does not have yet. The host may ask for any file of the manifest, also
   * one that did not change, so the caller must be able to reproduce each of them.
   */
  getContent(path: string): Promise<Uint8Array>;
  /**
   * Response header rules for the published files, in the `_headers` file format. They belong to the version:
   * send them on every publish, or the new version serves none.
   */
  headers?: string;
  /**
   * Upper bound of upload batches in this call (each is one request to the host). When more are needed the
   * call resolves with `done: false`; call `publish` again with the same manifest to continue.
   * Default `DEFAULT_MAX_UPLOAD_BATCHES`.
   */
  maxUploadBatches?: number;
  /**
   * Upper bound of files in one upload batch. The host's own grouping is split to fit, so a caller that can
   * fetch only a few files per call still makes progress: files sent in an earlier call are not asked for again.
   * Default: the host's grouping.
   */
  maxFilesPerUpload?: number;
}

export type PublishResult =
  | {
      done: true;
      /** The version now serving every domain. Pass it to `rollback` later. */
      versionId: string;
      /** Paths whose content was sent in this call. */
      uploaded: string[];
      /** Requests made to the host in this call, retries included. */
      requests: number;
    }
  | {
      done: false;
      uploaded: string[];
      /** Files the host still waits for. Nothing is live yet. */
      pending: number;
      requests: number;
    };

/** With the default, one `publish` call stays under 50 requests when nothing is retried. */
export const DEFAULT_MAX_UPLOAD_BATCHES = 40;

export interface HostingVersion {
  id: string;
  /** ISO 8601, or null when the host does not say. */
  createdAt: string | null;
  /** True for the version that serves visitors now. */
  live: boolean;
}

export interface BotCheckInput {
  /** The token the visitor's browser got from the challenge. */
  token: string;
  /** The managed domain the form was served on. A token solved on another hostname is refused. */
  host: string;
  /**
   * Name of the secret that belongs to this domain's widget (never the secret itself). Each adapter accepts
   * only names of the shape it documents; any other name answers `not-configured` without a lookup.
   */
  secretRef: string;
  remoteIp?: string;
}

export type BotCheckResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * `rejected`: missing, wrong, expired or reused token. `wrong-host`: solved on another hostname.
       * `not-configured`: no secret is stored under `secretRef`.
       */
      reason: "rejected" | "wrong-host" | "not-configured";
    };

/** The local part every offer email is sent from: `offers@<senderHost>`. */
export const NOTIFICATION_SENDER_LOCAL_PART = "offers";

export function notificationSender(senderHost: string): string {
  return `${NOTIFICATION_SENDER_LOCAL_PART}@${senderHost}`;
}

/** The offer email. Buyer input may go into `replyTo`, `subject` and `text` as typed; the adapter makes it safe. */
export interface NotificationMessage {
  /** A managed domain that may send mail; the message comes from `offers@<senderHost>`. */
  senderHost: string;
  /** Display name of the sender, for example "Deparked". */
  fromName?: string;
  /** A verified notify address. */
  to: string;
  /** The buyer, so the owner's reply goes straight to them. */
  replyTo: { email: string; name?: string };
  subject: string;
  /** Plain text body. */
  text: string;
}

/** A managed domain and the id its analytics are filed under at the host (`domains.analytics_site_tag`). */
export interface AnalyticsSite {
  host: string;
  siteId: string;
}

export interface AnalyticsQuery {
  /** One site for a domain's view, all of them for the overview. */
  sites: readonly AnalyticsSite[];
  /** First day, inclusive: `YYYY-MM-DD` (UTC). */
  from: string;
  /** Last day, inclusive: `YYYY-MM-DD` (UTC). */
  to: string;
}

export interface AnalyticsReport {
  /** Ascending by date. Days without visits are left out. */
  visitsByDay: { date: string; host: string; visits: number }[];
  /** Most visits first, over all `sites` together. An empty `host` means a direct visit. */
  referrers: { host: string; visits: number }[];
  /** Most visits first, over all `sites` together. */
  countries: { country: string; visits: number }[];
  /** Sum of `visitsByDay`. */
  totalVisits: number;
}

export interface NotifyAddress {
  /** The host's id for the address (`notify_addresses.cf_address_id`). It changes on `resend`. */
  id: string;
  email: string;
  verified: boolean;
  /** ISO 8601, null while the owner has not clicked the link in the verification mail. */
  verifiedAt: string | null;
}

export interface NotifyAddresses {
  list(): Promise<NotifyAddress[]>;
  /**
   * Adds the address (stored in lowercase) and has the host send its verification mail. Returns the existing
   * one when it is there already.
   */
  add(email: string): Promise<NotifyAddress>;
  /** Removing an address that is already gone is not an error. */
  remove(id: string): Promise<void>;
  /**
   * Sends the verification mail again. Does nothing for a verified address. The returned address may carry
   * a new `id`: store it. When this fails halfway the old `id` is dead and the address may be gone: a later
   * call then fails with `not-found`, and the caller recovers by calling `add` again.
   */
  resend(id: string): Promise<NotifyAddress>;
}

/** Which of the two apps a route sends requests to: the static pages or the admin. */
export type RouteTarget = "sites" | "admin";

export interface HostingRoute {
  id: string;
  /** For example `example.com/*` or `example.com/admin*`. */
  pattern: string;
  /** `other`: the route points at something Deparked did not create. */
  target: RouteTarget | "other";
}

/**
 * Request routing of one domain. `domainId` is the host's id for the domain (`domains.zone_id`).
 * Deliberately small: provisioning (rules, DNS, the ledger) lives in `@deparked/provision`.
 */
export interface HostingRoutes {
  list(domainId: string): Promise<HostingRoute[]>;
  /**
   * Returns the existing route when the pattern already points at the target. Fails with `conflict` when
   * the pattern is taken by something else: it never replaces a route.
   */
  add(domainId: string, route: { pattern: string; target: RouteTarget }): Promise<HostingRoute>;
  /**
   * Removes a route to the pages or the admin. Fails with `conflict` for a route that points at something
   * else (it is never deleted) and with `not-found` when the domain has no such route.
   */
  remove(domainId: string, routeId: string): Promise<void>;
}

export interface HostingAdapter {
  /**
   * Makes `files` the complete set of published pages and puts it live. Only files the host lacks are
   * fetched and sent. Safe to repeat: an unchanged manifest uploads nothing.
   */
  publish(input: PublishInput): Promise<PublishResult>;
  /** Puts an earlier version live again. The caller's manifest table then no longer describes what is live. */
  rollback(versionId: string): Promise<{ versionId: string }>;
  /** Newest first. */
  listVersions(options?: { limit?: number }): Promise<HostingVersion[]>;
  /** Resolves for a refused token; throws only when the check itself could not run. */
  verifyBotCheck(input: BotCheckInput): Promise<BotCheckResult>;
  /** Throws a `HostingError` when the mail was not accepted. The offer must already be stored. */
  sendNotification(message: NotificationMessage): Promise<void>;
  readAnalytics(query: AnalyticsQuery): Promise<AnalyticsReport>;
  readonly notifyAddresses: NotifyAddresses;
  readonly routes: HostingRoutes;
}

/**
 * A content hash in the shape `PublishFile.hash` wants: the first 32 hex characters of SHA-256 over the
 * content followed by the file extension, so equal bytes under another type are another file.
 */
export async function contentHash(path: string, content: Uint8Array): Promise<string> {
  const extension = new TextEncoder().encode(/\.([^./]+)$/.exec(path)?.[1] ?? "");
  const input = new Uint8Array(content.length + extension.length);
  input.set(content);
  input.set(extension, content.length);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

const HASH = /^[0-9a-f]{32}$/;

/** Checks a manifest before it is sent anywhere. Throws `HostingError` (`invalid-input`) naming the first problem. */
export function assertPublishFiles(files: readonly PublishFile[]): void {
  if (files.length === 0) throw new HostingError("invalid-input", "Nothing to publish: the file list is empty.");
  const seen = new Set<string>();
  for (const file of files) {
    const problem = !file.path.startsWith("/")
      ? "its path must start with a slash"
      : seen.has(file.path)
        ? "it is listed twice"
        : !HASH.test(file.hash)
          ? "its hash must be 32 lowercase hex characters"
          : !Number.isInteger(file.size) || file.size < 0
            ? "its size must be a whole number of bytes"
            : file.contentType === ""
              ? "it has no content type"
              : undefined;
    if (problem !== undefined) throw new HostingError("invalid-input", `Cannot publish ${file.path}: ${problem}.`);
    seen.add(file.path);
  }
}

export type {
  AccountDomain,
  AccountDomainPage,
  DomainPreview,
  DomainSetup,
  HubSetup,
  MailState,
  ReleaseChange,
  ReleaseChangeResult,
  ReleasePin,
  ReleaseStatus,
  ReplaceTokenResult,
  SetupChange,
  SetupConfirmation,
  SetupConfirmations,
  SetupEffect,
  SetupState,
  SetupStepReport,
  TokenHealth,
  TokenPermissionGap,
} from "./setup";
