// The 13 tables of the decision doc, section 5. `migrations/0001_init.sql` is the same schema as SQL;
// `migrations.test.ts` fails when the two drift apart.
//
// Conventions:
// - Timestamps are INTEGER epoch milliseconds (`Date.now()`), everywhere. Callers pass `now`.
// - Money is `amount_minor` (integer minor units) plus an ISO currency code.
// - Enums are TEXT with a CHECK constraint; the value lists below are the single source for both.
// - JSON columns hold serialised JSON; readers validate it (`packages/config` for configs).
// - Single-row tables have `id INTEGER PRIMARY KEY CHECK (id = 1)`.
import { type SQL, sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const INSTALL_STEPS = ["migrate", "download", "sites", "admin", "done"] as const;
export const INSTALL_STEP_STATUSES = ["pending", "running", "failed", "done"] as const;
export const DOMAIN_STATUSES = ["placeholder", "live", "off", "removed", "error"] as const;
export const EMAIL_ROUTING_STATES = ["none", "enabled", "kept_external"] as const;
export const OFFER_STATUSES = ["new", "replied", "ignored"] as const;
export const EMAIL_STATUSES = ["pending", "sent", "failed"] as const;
export const DEPLOYMENT_WORKERS = ["sites", "admin"] as const;
export const DEPLOYMENT_KINDS = ["install", "publish", "update", "rollback"] as const;
export const DEPLOYMENT_STATUSES = ["running", "done", "failed"] as const;
export const LEDGER_RESOURCES = [
  "route",
  "rule",
  "dns_record",
  "turnstile_hostname",
  "analytics_site",
  "email_routing",
  "worker",
  "secret",
] as const;
export const LEDGER_ACTIONS = ["created", "changed"] as const;

export type InstallStep = (typeof INSTALL_STEPS)[number];
export type InstallStepStatus = (typeof INSTALL_STEP_STATUSES)[number];
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];
export type EmailRoutingState = (typeof EMAIL_ROUTING_STATES)[number];
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export type DeploymentWorker = (typeof DEPLOYMENT_WORKERS)[number];
export type DeploymentKind = (typeof DEPLOYMENT_KINDS)[number];
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];
export type LedgerResource = (typeof LEDGER_RESOURCES)[number];
export type LedgerAction = (typeof LEDGER_ACTIONS)[number];

/** Cloudflare allows 10 hostnames per Turnstile widget (decision doc, section 6). */
export const TURNSTILE_HOSTNAMES_PER_WIDGET = 10;

// The values are compile-time constants without quotes, so inlining them is safe.
function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
}

export const workspace = sqliteTable(
  "workspace",
  {
    id: integer("id").primaryKey(),
    passwordHash: text("password_hash"),
    passwordSalt: text("password_salt"),
    passwordIterations: integer("password_iterations"),
    sessionVersion: integer("session_version").notNull().default(1),
    setupSecretHash: text("setup_secret_hash"),
    setupSecretExpiresAt: integer("setup_secret_expires_at"),
    setupDoneAt: integer("setup_done_at"),
    cfAccountId: text("cf_account_id"),
    installedRelease: text("installed_release"),
    latestRelease: text("latest_release"),
    releaseCheckedAt: integer("release_checked_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [check("workspace_single_row", sql`${t.id} = 1`)],
);

export const installState = sqliteTable(
  "install_state",
  {
    id: integer("id").primaryKey(),
    ownershipNonce: text("ownership_nonce"),
    nonceCreatedAt: integer("nonce_created_at"),
    step: text("step", { enum: INSTALL_STEPS }).notNull().default("migrate"),
    stepStatus: text("step_status", { enum: INSTALL_STEP_STATUSES }).notNull().default("pending"),
    lastError: text("last_error"),
    releaseVersion: text("release_version"),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
  },
  (t) => [
    check("install_state_single_row", sql`${t.id} = 1`),
    check("install_state_step", oneOf(t.step, INSTALL_STEPS)),
    check("install_state_step_status", oneOf(t.stepStatus, INSTALL_STEP_STATUSES)),
  ],
);

export const notifyAddresses = sqliteTable("notify_addresses", {
  email: text("email").primaryKey(),
  cfAddressId: text("cf_address_id"),
  verifiedAt: integer("verified_at"),
  lastResentAt: integer("last_resent_at"),
  createdAt: integer("created_at").notNull(),
});

export const turnstileWidgets = sqliteTable(
  "turnstile_widgets",
  {
    sitekey: text("sitekey").primaryKey(),
    name: text("name").notNull().unique("turnstile_widgets_name_unique"),
    hostnameCount: integer("hostname_count").notNull().default(0),
    secretName: text("secret_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    check(
      "turnstile_widgets_hostname_count",
      sql`${t.hostnameCount} between 0 and ${sql.raw(String(TURNSTILE_HOSTNAMES_PER_WIDGET))}`,
    ),
    index("turnstile_widgets_hostname_count_idx").on(t.hostnameCount),
  ],
);

export const domains = sqliteTable(
  "domains",
  {
    host: text("host").primaryKey(),
    status: text("status", { enum: DOMAIN_STATUSES }).notNull().default("placeholder"),
    zoneId: text("zone_id").notNull(),
    turnstileWidgetId: text("turnstile_widget_id").references(() => turnstileWidgets.sitekey),
    analyticsSiteTag: text("analytics_site_tag"),
    analyticsBeaconToken: text("analytics_beacon_token"),
    emailRoutingState: text("email_routing_state", { enum: EMAIL_ROUTING_STATES }).notNull().default("none"),
    senderHost: text("sender_host"),
    notifyEmail: text("notify_email").references(() => notifyAddresses.email, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    turnedOffAt: integer("turned_off_at"),
    removedAt: integer("removed_at"),
  },
  (t) => [
    check("domains_status", oneOf(t.status, DOMAIN_STATUSES)),
    check("domains_email_routing_state", oneOf(t.emailRoutingState, EMAIL_ROUTING_STATES)),
    // Deleting a widget or a notify address checks its foreign key from this side.
    index("domains_turnstile_widget_id_idx").on(t.turnstileWidgetId),
    index("domains_notify_email_idx").on(t.notifyEmail),
  ],
);

export const config = sqliteTable("config", {
  host: text("host")
    .primaryKey()
    .references(() => domains.host),
  draftJson: text("draft_json").notNull(),
  draftSchemaVersion: integer("draft_schema_version").notNull(),
  liveJson: text("live_json"),
  liveSchemaVersion: integer("live_schema_version"),
  updatedAt: integer("updated_at").notNull(),
  publishedAt: integer("published_at"),
  publishedRelease: text("published_release"),
});

export const configHistory = sqliteTable(
  "config_history",
  {
    id: integer("id").primaryKey(),
    host: text("host")
      .notNull()
      .references(() => domains.host),
    json: text("json").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    publishedAt: integer("published_at").notNull(),
  },
  (t) => [index("config_history_host_published_at_idx").on(t.host, t.publishedAt)],
);

export const offers = sqliteTable(
  "offers",
  {
    id: text("id").primaryKey(),
    host: text("host")
      .notNull()
      .references(() => domains.host),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    country: text("country"),
    message: text("message"),
    status: text("status", { enum: OFFER_STATUSES }).notNull().default("new"),
    emailStatus: text("email_status", { enum: EMAIL_STATUSES }).notNull().default("pending"),
    emailError: text("email_error"),
    notifiedTo: text("notified_to"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check("offers_status", oneOf(t.status, OFFER_STATUSES)),
    check("offers_email_status", oneOf(t.emailStatus, EMAIL_STATUSES)),
    check("offers_amount_minor", sql`${t.amountMinor} >= 0`),
    index("offers_host_created_at_idx").on(t.host, t.createdAt),
    index("offers_status_created_at_idx").on(t.status, t.createdAt),
    index("offers_created_at_idx").on(t.createdAt),
  ],
);

export const siteFiles = sqliteTable(
  "site_files",
  {
    path: text("path").primaryKey(),
    host: text("host").references(() => domains.host),
    hash: text("hash").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("site_files_host_idx").on(t.host)],
);

export const deployments = sqliteTable(
  "deployments",
  {
    id: integer("id").primaryKey(),
    worker: text("worker", { enum: DEPLOYMENT_WORKERS }).notNull(),
    kind: text("kind", { enum: DEPLOYMENT_KINDS }).notNull(),
    host: text("host").references(() => domains.host),
    releaseVersion: text("release_version"),
    cfVersionId: text("cf_version_id"),
    status: text("status", { enum: DEPLOYMENT_STATUSES }).notNull().default("running"),
    error: text("error"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (t) => [
    check("deployments_worker", oneOf(t.worker, DEPLOYMENT_WORKERS)),
    check("deployments_kind", oneOf(t.kind, DEPLOYMENT_KINDS)),
    check("deployments_status", oneOf(t.status, DEPLOYMENT_STATUSES)),
    index("deployments_worker_started_at_idx").on(t.worker, t.startedAt),
    index("deployments_host_started_at_idx").on(t.host, t.startedAt),
  ],
);

export const publishLock = sqliteTable(
  "publish_lock",
  {
    id: integer("id").primaryKey(),
    deploymentId: integer("deployment_id")
      .notNull()
      .references(() => deployments.id),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [check("publish_lock_single_row", sql`${t.id} = 1`)],
);

export const ledger = sqliteTable(
  "ledger",
  {
    id: integer("id").primaryKey(),
    host: text("host").references(() => domains.host),
    zoneId: text("zone_id"),
    resource: text("resource", { enum: LEDGER_RESOURCES }).notNull(),
    cfId: text("cf_id"),
    action: text("action", { enum: LEDGER_ACTIONS }).notNull(),
    previousJson: text("previous_json"),
    createdAt: integer("created_at").notNull(),
    undoneAt: integer("undone_at"),
  },
  (t) => [
    check("ledger_resource", oneOf(t.resource, LEDGER_RESOURCES)),
    check("ledger_action", oneOf(t.action, LEDGER_ACTIONS)),
    index("ledger_host_created_at_idx").on(t.host, t.createdAt),
  ],
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [index("rate_limits_window_start_idx").on(t.windowStart)],
);

export type Workspace = typeof workspace.$inferSelect;
export type InstallState = typeof installState.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type Config = typeof config.$inferSelect;
export type ConfigHistoryEntry = typeof configHistory.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type NotifyAddress = typeof notifyAddresses.$inferSelect;
export type TurnstileWidget = typeof turnstileWidgets.$inferSelect;
export type SiteFile = typeof siteFiles.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type PublishLock = typeof publishLock.$inferSelect;
export type LedgerEntry = typeof ledger.$inferSelect;
export type RateLimit = typeof rateLimits.$inferSelect;
