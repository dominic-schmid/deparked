import {
  type AnalyticsQuery,
  type AnalyticsReport,
  assertPublishFiles,
  type BotCheckInput,
  type BotCheckResult,
  DEFAULT_MAX_UPLOAD_BATCHES,
  type HostingAdapter,
  HostingError,
  type HostingRoute,
  type NotificationMessage,
  type NotifyAddress,
  type PublishFile,
  type PublishInput,
  type PublishResult,
} from "./index";

export interface FakeAnalyticsRow {
  siteId: string;
  date: string;
  host: string;
  referrer: string;
  country: string;
  visits: number;
}

export interface FakeVersion {
  id: string;
  createdAt: string;
  files: PublishFile[];
  headers: string | undefined;
}

export interface FakeHostingOptions {
  /** Notify addresses that exist and are verified from the start. */
  verifiedAddresses?: string[];
  /** Files sent per upload batch. Default 50. */
  batchSize?: number;
}

type Method =
  | "publish"
  | "rollback"
  | "listVersions"
  | "verifyBotCheck"
  | "sendNotification"
  | "readAnalytics"
  | "notifyAddresses"
  | "routes";

function topBy(rows: FakeAnalyticsRow[], key: (row: FakeAnalyticsRow) => string): [string, number][] {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(key(row), (totals.get(key(row)) ?? 0) + row.visits);
  return [...totals].sort((a, b) => b[1] - a[1]);
}

/**
 * An in-memory `HostingAdapter` for unit tests of the admin. It behaves like the real thing where the admin
 * can tell: content is fetched only for files it has not seen, a notification needs a verified address, a
 * bot-check token works once and only on its own host.
 */
export function createFakeHosting(options: FakeHostingOptions = {}) {
  const batchSize = options.batchSize ?? 50;
  let nextId = 0;
  const id = (prefix: string) => `${prefix}-${++nextId}`;

  const stored = new Map<string, Uint8Array>();
  const versions: FakeVersion[] = [];
  let liveVersionId: string | undefined;
  const sent: NotificationMessage[] = [];
  const analytics: FakeAnalyticsRow[] = [];
  const botTokens = new Map<string, string>();
  let addresses: NotifyAddress[] = (options.verifiedAddresses ?? []).map((email) => ({
    id: id("address"),
    email,
    verified: true,
    verifiedAt: new Date(0).toISOString(),
  }));
  const verificationMails: string[] = [];
  const routes = new Map<string, HostingRoute[]>();
  const failures: { method: Method; error: Error }[] = [];

  function check(method: Method): void {
    const index = failures.findIndex((failure) => failure.method === method);
    if (index === -1) return;
    const [failure] = failures.splice(index, 1);
    if (failure !== undefined) throw failure.error;
  }

  function findAddress(addressId: string): NotifyAddress {
    const found = addresses.find((address) => address.id === addressId);
    if (found === undefined) throw new HostingError("not-found", "This notify address no longer exists.");
    return found;
  }

  const adapter: HostingAdapter = {
    async publish(input: PublishInput): Promise<PublishResult> {
      check("publish");
      assertPublishFiles(input.files);
      const missing = input.files.filter(
        (file, index) => !stored.has(file.hash) && input.files.findIndex((other) => other.hash === file.hash) === index,
      );
      const batches = Math.min(
        Math.ceil(missing.length / batchSize),
        input.maxUploadBatches ?? DEFAULT_MAX_UPLOAD_BATCHES,
      );
      const uploaded: string[] = [];
      for (const file of missing.slice(0, batches * batchSize)) {
        const content = await input.getContent(file.path);
        if (content.length !== file.size) {
          throw new HostingError("invalid-input", `Cannot publish ${file.path}: its content is not the size listed.`);
        }
        stored.set(file.hash, content);
        uploaded.push(file.path);
      }
      const pending = missing.length - uploaded.length;
      if (pending > 0) return { done: false, uploaded, pending, requests: 1 + batches };
      const version = {
        id: id("version"),
        createdAt: new Date().toISOString(),
        files: [...input.files],
        headers: input.headers,
      };
      versions.push(version);
      liveVersionId = version.id;
      return { done: true, versionId: version.id, uploaded, requests: 3 + batches };
    },

    async rollback(versionId) {
      check("rollback");
      if (!versions.some((version) => version.id === versionId)) {
        throw new HostingError("not-found", "This version no longer exists.");
      }
      liveVersionId = versionId;
      return { versionId };
    },

    async listVersions(listOptions) {
      check("listVersions");
      return versions
        .toReversed()
        .slice(0, listOptions?.limit ?? 20)
        .map((version) => ({ id: version.id, createdAt: version.createdAt, live: version.id === liveVersionId }));
    },

    async verifyBotCheck(input: BotCheckInput): Promise<BotCheckResult> {
      check("verifyBotCheck");
      const host = botTokens.get(input.token);
      if (host === undefined) return { ok: false, reason: "rejected" };
      botTokens.delete(input.token);
      return host === input.host.toLowerCase() ? { ok: true } : { ok: false, reason: "wrong-host" };
    },

    async sendNotification(message) {
      check("sendNotification");
      const to = addresses.find((address) => address.email.toLowerCase() === message.to.toLowerCase());
      if (to === undefined || !to.verified) {
        throw new HostingError("failed", "The email was not sent: the notify address is not verified yet.");
      }
      sent.push(message);
    },

    async readAnalytics(query: AnalyticsQuery): Promise<AnalyticsReport> {
      check("readAnalytics");
      const siteIds = new Set(query.sites.map((site) => site.siteId));
      const rows = analytics.filter((row) => siteIds.has(row.siteId) && row.date >= query.from && row.date <= query.to);
      const visitsByDay = topBy(rows, (row) => `${row.date}\n${row.host}`)
        .map(([key, visits]) => {
          const [date = "", host = ""] = key.split("\n");
          return { date, host, visits };
        })
        .sort((a, b) => a.date.localeCompare(b.date) || a.host.localeCompare(b.host));
      return {
        visitsByDay,
        referrers: topBy(rows, (row) => row.referrer).map(([host, visits]) => ({ host, visits })),
        countries: topBy(rows, (row) => row.country).map(([country, visits]) => ({ country, visits })),
        totalVisits: rows.reduce((sum, row) => sum + row.visits, 0),
      };
    },

    notifyAddresses: {
      async list() {
        check("notifyAddresses");
        return addresses.map((address) => ({ ...address }));
      },
      async add(input) {
        check("notifyAddresses");
        const email = input.trim().toLowerCase();
        const existing = addresses.find((address) => address.email.toLowerCase() === email);
        if (existing !== undefined) return { ...existing };
        const created = { id: id("address"), email, verified: false, verifiedAt: null };
        addresses.push(created);
        verificationMails.push(email);
        return { ...created };
      },
      async remove(addressId) {
        check("notifyAddresses");
        addresses = addresses.filter((address) => address.id !== addressId);
      },
      async resend(addressId) {
        check("notifyAddresses");
        const found = findAddress(addressId);
        if (found.verified) return { ...found };
        found.id = id("address");
        verificationMails.push(found.email);
        return { ...found };
      },
    },

    routes: {
      async list(domainId) {
        check("routes");
        return (routes.get(domainId) ?? []).map((route) => ({ ...route }));
      },
      async add(domainId, route) {
        check("routes");
        const existing = routes.get(domainId) ?? [];
        const same = existing.find((entry) => entry.pattern === route.pattern);
        if (same !== undefined && same.target !== route.target) {
          throw new HostingError("conflict", `The address ${route.pattern} is already used by something else.`);
        }
        if (same !== undefined) return { ...same };
        const created = { id: id("route"), pattern: route.pattern, target: route.target };
        routes.set(domainId, [...existing, created]);
        return { ...created };
      },
      async remove(domainId, routeId) {
        check("routes");
        const existing = routes.get(domainId) ?? [];
        const found = existing.find((route) => route.id === routeId);
        if (found === undefined) throw new HostingError("not-found", "This domain has no such route.");
        if (found.target === "other") {
          throw new HostingError("conflict", `The address ${found.pattern} belongs to something else and stays.`);
        }
        routes.set(
          domainId,
          existing.filter((route) => route !== found),
        );
      },
    },
  };

  return {
    ...adapter,
    /** Every version published so far, oldest first. */
    versions,
    /** Notifications that were accepted, oldest first. */
    sent,
    /** Rows `readAnalytics` answers from: push what a test needs. */
    analytics,
    /** Addresses a verification mail went to, oldest first. */
    verificationMails,
    /** The files visitors get now. */
    liveFiles(): PublishFile[] {
      return versions.find((version) => version.id === liveVersionId)?.files ?? [];
    },
    /** A token the next `verifyBotCheck` accepts once, if it comes from `host`. */
    acceptBotToken(token: string, host: string): void {
      botTokens.set(token, host.toLowerCase());
    },
    /** What the owner's click on the verification link does. */
    verifyAddress(email: string): void {
      const found = addresses.find((address) => address.email.toLowerCase() === email.toLowerCase());
      if (found === undefined) throw new Error(`no address ${email}`);
      found.verified = true;
      found.verifiedAt = new Date().toISOString();
    },
    /** Something outside Deparked already uses this pattern. */
    seedForeignRoute(domainId: string, pattern: string): void {
      routes.set(domainId, [...(routes.get(domainId) ?? []), { id: id("route"), pattern, target: "other" }]);
    },
    /** The next call to `method` throws `error`. */
    failNext(method: Method, error: Error): void {
      failures.push({ method, error });
    },
    /** The next call to `method` fails the way a revoked token does. */
    rejectCredentials(method: Method): void {
      failures.push({
        method,
        error: new HostingError("credentials-rejected", "The saved token was rejected. Replace it in Settings."),
      });
    },
  };
}

export type FakeHosting = ReturnType<typeof createFakeHosting>;
