import { createCloudflareClient, type FetchLike } from "@deparked/cf";
import { type Db, getDomain } from "@deparked/db";
import type {
  AccountDomainPage,
  DomainPreview,
  DomainSetup,
  MailState,
  SetupChange,
  SetupConfirmation,
  SetupConfirmations,
} from "@deparked/hosting";
import {
  describeRemoval,
  dryRun,
  inspectDomain,
  type Plan,
  type ProvisionContext,
  planAttachDomain,
  planRemoveDomain,
  planTurnOff,
  runNextStep,
  type WorkerNames,
  withProvisionLock,
} from "@deparked/provision";
import { cloudflare } from "./errors";

export interface CloudflareSetupOptions {
  /** The owner's API token. Never logged; errors are redacted by the client. */
  token: string;
  accountId: string;
  /** Defaults to Cloudflare's API. The E2E harness points this at the mock server. */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Waits between retries. Tests pass one that does not wait. */
  sleep?: (ms: number) => Promise<void>;
  db: Db;
  now: () => number;
  workers?: WorkerNames;
  /**
   * Publishes the placeholder page of a host and records its files in `site_files`. Called while the
   * domain's status is still `off`. An error it throws is not a Cloudflare error: it leaves `step` as it is.
   */
  publishPlaceholder(host: string): Promise<void>;
}

/** Zones per request to Cloudflare, and how many requests one picker page may make. */
const ZONES_PER_REQUEST = 50;
const MAX_ZONE_REQUESTS = 4;
/** A picker page is full with this many domains that are not managed yet. */
const PICKER_PAGE = 20;

const MAIL: Record<"none" | "cloudflare" | "external", MailState> = {
  none: "none",
  cloudflare: "hosting",
  external: "external",
};

/** The add-domain flow, Turn off and Remove, on `@deparked/provision`. Build one per request. */
export function createCloudflareDomainSetup(options: CloudflareSetupOptions): DomainSetup {
  const cf = createCloudflareClient({
    token: options.token,
    accountId: options.accountId,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const ctx: ProvisionContext = {
    cf,
    db: options.db,
    now: options.now,
    publishPlaceholder: options.publishPlaceholder,
    ...(options.workers === undefined ? {} : { workers: options.workers }),
  };

  function plan(change: SetupChange, host: string, confirmations: SetupConfirmations = {}): Plan {
    if (change === "attach") return planAttachDomain(ctx, host, confirmations);
    return change === "turn-off" ? planTurnOff(ctx, host) : planRemoveDomain(ctx, host);
  }

  return {
    listAccountDomains: ({ search, page = 1, exclude = new Set() }) =>
      cloudflare(async () => {
        const domains: AccountDomainPage["domains"] = [];
        let current = page;
        for (let requests = 0; requests < MAX_ZONE_REQUESTS && domains.length < PICKER_PAGE; requests += 1) {
          const result = await cf.zones.page({
            ...(search === undefined ? {} : { contains: search }),
            page: current,
            perPage: ZONES_PER_REQUEST,
          });
          for (const zone of result.zones) {
            if (!exclude.has(zone.name)) {
              domains.push({
                id: zone.id,
                name: zone.name,
                active: zone.status === undefined || zone.status === "active",
              });
            }
          }
          if (current >= result.totalPages || result.zones.length === 0) return { domains, nextPage: null };
          current += 1;
        }
        return { domains, nextPage: current };
      }),

    preview: (host, confirmations) =>
      cloudflare(async (): Promise<DomainPreview> => {
        const inspection = await inspectDomain(ctx, host);
        const report = await dryRun(plan("attach", inspection.host, confirmations));
        const row = await getDomain(options.db, inspection.host);
        const isOn = inspection.managed === "placeholder" || inspection.managed === "live";
        const asks: SetupConfirmation[] = [];
        if (inspection.servesWebsite && !isOn) asks.push("takeOverLiveSite");
        if (inspection.sameRoutePatterns.length > 0) asks.push("repointExistingRoutes");
        if (inspection.mx.state === "external" && row?.emailRoutingState !== "enabled") asks.push("replaceExistingMx");
        return {
          host: inspection.host,
          inAccount: inspection.zone !== null,
          summary: inspection.summary,
          blockers: inspection.blockers,
          asks,
          servesWebsite: inspection.servesWebsite,
          takenRoutes: inspection.sameRoutePatterns.map((route) => route.pattern),
          mail: MAIL[inspection.mx.state],
          mailServers: inspection.mx.targets,
          steps: report.steps.map((step) =>
            step.status === "blocked"
              ? { id: step.id, title: step.title, status: step.status, effects: [], reason: step.reason }
              : { id: step.id, title: step.title, status: step.status, effects: step.effects, reason: "" },
          ),
          nothingToDo: report.nothingToDo,
        };
      }),

    stepTitles: (change, host) => plan(change, host).steps.map((step) => ({ id: step.id, title: step.title })),

    async step(change, host, state, confirmations) {
      const report = await runNextStep(plan(change, host, confirmations), state);
      return {
        step: report.step,
        outcome: report.outcome,
        message: report.message,
        effects: report.effects,
        state: report.state,
        finished: report.finished,
        credentialsRejected: report.errorStatus === 401 || report.errorStatus === 403,
      };
    },

    withLock: (work) => withProvisionLock(ctx, work),

    describeRemoval: (host) => describeRemoval(ctx, host),
  };
}
