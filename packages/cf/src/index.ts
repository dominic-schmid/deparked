import { analyticsApi } from "./analytics";
import { d1Api } from "./d1";
import { emailApi } from "./email";
import { type ClientOptions, createHttp } from "./http";
import { rulesetsApi } from "./rulesets";
import { tokensApi } from "./tokens";
import { turnstileApi } from "./turnstile";
import { workersApi } from "./workers";
import { accountsApi, zonesApi } from "./zones";

/**
 * A small fetch-based Cloudflare API client. Runs in workerd and Node. Every call retries on 429 and 5xx
 * (up to `maxAttempts`), so the worst case is `maxAttempts` times the request count in a method's docs.
 * On Workers Free a request may make 50 subrequests: read `requestCount` before and after to check a budget.
 */
export function createCloudflareClient(options: ClientOptions) {
  const http = createHttp(options);
  return {
    accountId: options.accountId,
    get requestCount() {
      return http.requestCount;
    },
    tokens: tokensApi(http),
    accounts: accountsApi(http),
    zones: zonesApi(http),
    rulesets: rulesetsApi(http),
    workers: workersApi(http),
    d1: d1Api(http),
    turnstile: turnstileApi(http),
    analytics: analyticsApi(http),
    email: emailApi(http),
  };
}

export type CloudflareClient = ReturnType<typeof createCloudflareClient>;

export type { AnalyticsReport, AnalyticsSite } from "./analytics";
export type { D1Database, D1StatementResult } from "./d1";
export type { DestinationAddress, EmailRoutingSettings, MxState } from "./email";
export { classifyMx } from "./email";
export type { ClientOptions, CloudflareErrorDetail, FetchLike, PageOptions } from "./http";
export { CloudflareApiError } from "./http";
export type {
  RedirectRuleInput,
  RewriteRuleInput,
  Rule,
  RuleInput,
  Ruleset,
  RulesetPhase,
} from "./rulesets";
export type { PermissionReport, TokenPermission, TokenStatus } from "./tokens";
export { PROBE_PERMISSION_LABELS, TOKEN_PERMISSIONS, tokenTemplateUrl } from "./tokens";
export type { SiteverifyResult, TurnstileMode, TurnstileWidget, TurnstileWidgetWithSecret } from "./turnstile";
export { TURNSTILE_MAX_HOSTNAMES, TURNSTILE_SITEVERIFY_URL, verifyTurnstile } from "./turnstile";
export type {
  AssetManifest,
  AssetManifestEntry,
  AssetsConfig,
  WorkerBinding,
  WorkerDeployment,
  WorkerModule,
  WorkerSettings,
  WorkerUpload,
  WorkerVersion,
} from "./workers";
export { hashAsset } from "./workers";
export type { Account, DnsRecord, WorkerRoute, Zone } from "./zones";
