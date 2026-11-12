export type GateInput = {
  /** The request path as sent; the gate normalises it itself. */
  pathname: string;
  /** A server function call (RPC), which gets a status code instead of a redirect. */
  isServerFn: boolean;
  hasPassword: boolean;
  /** A one-time setup secret exists and has not expired. */
  setupPending: boolean;
  hasSession: boolean;
};

export type GateDecision = { type: "next" } | { type: "redirect"; to: string } | { type: "unauthorized" };

export const LOGIN_PATH = "/admin/login";
export const SETUP_PATH = "/admin/setup";
export const SETUP_DONE_PATH = "/admin/setup/done";
export const HOME_PATH = "/admin";

const NEXT: GateDecision = { type: "next" };

function redirect(to: string): GateDecision {
  return { type: "redirect", to };
}

// The router matches paths without regard to case or a trailing slash, so the gate compares the same way.
// Anything it cannot decode is simply not a public path.
function normalise(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {}
  path = path.toLowerCase().replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/** `/api/*` is public and has its own checks (offers); the gate, Origin check and admin headers skip it. */
export function isPublicApi(pathname: string): boolean {
  return /^\/api\//.test(pathname);
}

/**
 * Default deny: every request the Worker renders needs a session, except the login and setup screens and the
 * `/` redirect. Static files under `/admin/_assets` never reach the Worker script.
 */
export function gate(input: GateInput): GateDecision {
  const path = normalise(input.pathname);
  const needsSetup = !input.hasPassword && input.setupPending;
  if (input.isServerFn) return input.hasSession ? NEXT : { type: "unauthorized" };
  switch (path) {
    case "/":
      return NEXT;
    case LOGIN_PATH:
      if (input.hasSession) return redirect(HOME_PATH);
      return needsSetup ? redirect(SETUP_PATH) : NEXT;
    case SETUP_PATH:
      // A pending secret also covers recovery: the installer issues a new one for a workspace that has a password.
      return input.hasPassword && !input.setupPending ? redirect(SETUP_DONE_PATH) : NEXT;
    case SETUP_DONE_PATH:
      return input.hasPassword && !input.setupPending ? NEXT : redirect(SETUP_PATH);
    default:
      if (input.hasSession) return NEXT;
      return redirect(needsSetup ? SETUP_PATH : LOGIN_PATH);
  }
}
