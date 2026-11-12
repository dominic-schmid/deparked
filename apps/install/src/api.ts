// The installer's JSON API, shared by the Worker and the page. Every POST carries the token in its body, never in
// a URL; the page keeps it in memory only.

export interface Effect {
  kind: "create" | "change" | "remove" | "restore" | "reuse";
  what: string;
}

export type ErrorCode =
  | "bad-request"
  | "invalid-token"
  | "no-account"
  | "foreign-account"
  | "missing-permissions"
  | "no-release"
  | "release"
  | "busy"
  | "not-installed"
  | "cloudflare";

export interface ApiError {
  ok: false;
  error: ErrorCode;
  /** Plain words: what happened and what to do next. Never contains the token. */
  message: string;
}

export interface Status {
  phase: "fresh" | "in-progress" | "installed";
  /** The release this installer installs, or null when it was built before the first release. */
  pinnedRelease: string | null;
  installedRelease: string | null;
  /** `https://deparked-admin.<account>.workers.dev` when the installer runs on workers.dev. */
  adminUrl: string | null;
  startedAt: number | null;
  /** The step an unfinished install stopped at, and why. */
  stoppedAt: string | null;
  lastError: string | null;
}

export interface Account {
  id: string;
  name: string;
}

export interface PermissionGap {
  label: string;
  why: string;
  scope: "account" | "zone";
}

export interface PlanStep {
  id: string;
  title: string;
  status: "done" | "needed" | "blocked";
  effects: Effect[];
  reason?: string;
}

export interface CheckRequest {
  token: string;
  accountId?: string;
}

export type CheckResponse =
  | { ok: true; status: "pick-account"; accounts: Account[] }
  | {
      ok: true;
      status: "ready";
      account: Account;
      release: string;
      /** Permissions the token lacks. The install cannot start until this is empty. */
      missing: PermissionGap[];
      /** Permissions that could not be checked (the account has no domain yet). */
      unchecked: PermissionGap[];
      steps: PlanStep[];
      nothingToDo: boolean;
    }
  | ApiError;

export interface StepRequest {
  token: string;
  accountId: string;
  next: number;
}

export interface StepReport {
  step: { id: string; title: string; index: number; total: number } | null;
  outcome: "ran" | "already-done" | "blocked" | "failed" | "busy" | "finished";
  message: string;
  effects: Effect[];
  finished: boolean;
  next: number;
}

export type StepResponse = { ok: true; report: StepReport } | ApiError;

export interface FinishRequest {
  token: string;
  accountId: string;
}

export type FinishResponse = { ok: true; setupUrl: string; adminUrl: string } | ApiError;
