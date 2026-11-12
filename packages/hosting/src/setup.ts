/**
 * Attaching a domain to Deparked and taking it off again, step by step. Each host's implementation runs its
 * own provisioning behind this interface and keeps its own record of what it changed, so every step is safe to
 * repeat and every change can be undone.
 */

/** A domain of the hosting account, as the add-domain picker lists it. */
export interface AccountDomain {
  /** The host's id for the domain (`domains.zone_id`). */
  id: string;
  name: string;
  /** False while the host has not finished adding the domain (its nameservers, for example). */
  active: boolean;
}

export interface AccountDomainPage {
  domains: AccountDomain[];
  /** The page to ask for next, or null after the last one. */
  nextPage: number | null;
}

/** One thing a step does or would do, in words the owner can read. `reuse` changes nothing. */
export interface SetupEffect {
  kind: "create" | "change" | "remove" | "restore" | "reuse";
  what: string;
}

/**
 * The three things that touch something the owner already has. Each defaults to leaving it alone; the
 * attach stops and asks instead.
 */
export interface SetupConfirmations {
  /** The domain serves a website today and Deparked may take the address over. */
  takeOverLiveSite?: boolean;
  /** An existing route with exactly Deparked's pattern may be pointed at Deparked. */
  repointExistingRoutes?: boolean;
  /** The domain's existing mail records may be replaced so offers are sent from it. */
  replaceExistingMx?: boolean;
}

export type SetupConfirmation = keyof SetupConfirmations;

/** Where a domain's email goes today. `hosting`: through the host's own email service already. */
export type MailState = "none" | "hosting" | "external";

/** What attaching a domain would do, before anything changes. Only reads. */
export interface DomainPreview {
  host: string;
  /** False when the account has no such domain. */
  inAccount: boolean;
  /** What the domain does today and what attaching changes, in plain words. */
  summary: string;
  /** Why it cannot be attached until the owner changes something. Empty when it can. */
  blockers: string[];
  /** The confirmations this domain needs. Only these are asked for. */
  asks: SetupConfirmation[];
  servesWebsite: boolean;
  /** Addresses another app answers on today that Deparked would point at itself. */
  takenRoutes: string[];
  mail: MailState;
  /** The domain's current mail servers. */
  mailServers: string[];
  /** Step by step, with the confirmations given. */
  steps: { id: string; title: string; status: "done" | "needed" | "blocked"; effects: SetupEffect[]; reason: string }[];
  /** True when every step is done already. */
  nothingToDo: boolean;
}

export type SetupChange = "attach" | "turn-off" | "remove";

/** Where a change stands. The browser keeps it between requests and sends it back. */
export interface SetupState {
  /** Index of the step the next call looks at. */
  next: number;
}

export interface SetupStepReport {
  /** Null when the change had already finished. */
  step: { id: string; title: string; index: number; total: number } | null;
  /**
   * `ran`: the step did its work. `already-done`: nothing was needed. `blocked`: the owner must act; the state
   * did not move. `failed`: the host refused a call; call again with the same state to retry. `busy`: another
   * change is running; try again shortly. `finished`: no step was left.
   */
  outcome: "ran" | "already-done" | "blocked" | "failed" | "busy" | "finished";
  message: string;
  effects: SetupEffect[];
  state: SetupState;
  finished: boolean;
  /** True on `failed` when the host refused the stored credentials or they lack a permission. */
  credentialsRejected: boolean;
}

export interface DomainSetup {
  /**
   * One page of the account's domains, by name. `search` keeps names that contain it; names in `exclude` (the
   * domains already managed) are left out. Stays within a few requests to the host whatever the number of
   * domains. `page` is the `nextPage` of the page before; the first page is 1.
   */
  listAccountDomains(query: {
    search?: string;
    page?: number;
    exclude?: ReadonlySet<string>;
  }): Promise<AccountDomainPage>;
  preview(host: string, confirmations: SetupConfirmations): Promise<DomainPreview>;
  /** The titles of a change's steps, in order. No request. */
  stepTitles(change: SetupChange, host: string): { id: string; title: string }[];
  /** Looks at exactly one step of the change: runs it when needed. One call per request. */
  step(
    change: SetupChange,
    host: string,
    state: SetupState,
    confirmations: SetupConfirmations,
  ): Promise<SetupStepReport>;
  /**
   * Runs `work` while no step of any change runs, so work that belongs to a change (its publish) cannot interleave
   * with an attach or a turn off. `busy` when a step holds the lock: nothing ran.
   */
  withLock<T>(work: () => Promise<T>): Promise<{ status: "ran"; value: T } | { status: "busy" }>;
  /** What Turn off and Remove delete or put back, and what stays. No request to the host. */
  describeRemoval(host: string): Promise<{ effects: SetupEffect[]; keeps: string[] }>;
}

/** A permission the stored token lacks or that could not be tried, with why Deparked needs it. */
export interface TokenPermissionGap {
  label: string;
  why: string;
}

/**
 * The stored token as the host sees it. `rejected`: the host refuses it (deleted, expired, disabled).
 * `incomplete`: it works but lacks a permission Deparked uses. `unchecked` names permissions that could not be
 * tried, for example zone permissions before the account has a domain.
 */
export interface TokenHealth {
  state: "ok" | "incomplete" | "rejected";
  missing: TokenPermissionGap[];
  unchecked: TokenPermissionGap[];
}

export type ReplaceTokenResult = { ok: true; health: TokenHealth } | { ok: false; message: string };

/** A release by its pin: the version and the SHA-256 of its release.json. */
export interface ReleasePin {
  version: string;
  sha256: string;
}

/** An update to a newer release, or a rollback to the one installed before the last update. */
export interface ReleaseChange {
  kind: "update" | "rollback";
  pin: ReleasePin;
  startedAt: number;
  finished: boolean;
}

export interface ReleaseStatus {
  /** Null before the install. `sha256` is null for an install that did not record its pin. */
  installed: { version: string; sha256: string | null } | null;
  /** The change last started, finished or not. */
  change: ReleaseChange | null;
  /** What Roll back installs, or null when there is nothing to go back to. */
  rollbackTo: ReleasePin | null;
}

export type ReleaseChangeResult = { ok: true; change: ReleaseChange } | { ok: false; message: string };

/** The hub as a whole: its token, Update and Rollback, and Uninstall. */
export interface HubSetup {
  /** False when the host refuses the stored token. One request; for the shell's banner. */
  tokenAccepted(): Promise<boolean>;
  /** Asks the host about the stored token. A few read requests. */
  tokenHealth(): Promise<TokenHealth>;
  /**
   * Checks that `token` works, belongs to the same account and has every permission, then stores it in place of
   * the old one. Nothing is stored when a check fails. The token is never logged or returned.
   */
  replaceToken(token: string): Promise<ReplaceTokenResult>;
  /** What Uninstall deletes, and what stays. Reads the hub's own records only. */
  describeUninstall(): Promise<{ steps: { id: string; title: string }[]; effects: SetupEffect[]; keeps: string[] }>;
  /** Looks at exactly one step of Uninstall: runs it when needed. One call per request. */
  uninstallStep(state: SetupState): Promise<SetupStepReport>;
  /** The installed release, the running change and the rollback target. Reads the hub's own records only. */
  releaseStatus(): Promise<ReleaseStatus>;
  /**
   * What updating to `pin` changes, step by step, without changing anything. Checks release.json against the pin
   * and refuses a version that is not newer than the installed one.
   */
  previewUpdate(pin: ReleasePin): Promise<
    | {
        ok: true;
        steps: { id: string; title: string; status: "done" | "needed" | "blocked"; effects: SetupEffect[] }[];
      }
    | { ok: false; message: string }
  >;
  /** Starts the update to `pin`, which the owner confirmed. Starting the same one again resumes it. */
  startUpdate(pin: ReleasePin): Promise<ReleaseChangeResult>;
  /** Starts going back to `releaseStatus().rollbackTo`. The only way to install an older version. */
  startRollback(): Promise<ReleaseChangeResult>;
  /** The titles of an update's or rollback's steps, in order. No request. */
  releaseStepTitles(): { id: string; title: string }[];
  /**
   * Looks at exactly one step of the running change: runs it when needed. One call per request; a step runs only
   * once every step before it is done.
   */
  releaseStep(state: SetupState): Promise<SetupStepReport>;
  /** Marks the running change finished once its release is installed. */
  finishRelease(): Promise<ReleaseChangeResult>;
}
