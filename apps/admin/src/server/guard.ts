import { createMiddleware } from "@tanstack/react-start";
import { isSetupPending } from "./auth/account";
import { gate, isPublicApi } from "./auth/gate";
import { createNonce, securityHeaders } from "./auth/headers";
import { isAllowedOrigin } from "./auth/origin";
import { readSession } from "./request";

/**
 * The one global request middleware. It runs before every page, server route and server function, in this order:
 *
 * 1. `/api/*` passes untouched (public; those routes do their own checks).
 * 2. Origin check on state-changing methods: 403.
 * 3. Auth gate (default deny, see `gate`): redirect to login or setup, or 401 for a server function.
 * 4. The handler runs, with the CSP nonce in its context.
 * 5. Security headers go on whatever response comes back, including the 403, 401 and redirects.
 */
export const adminGuard = createMiddleware().server(async ({ request, handlerType, next }) => {
  const { pathname } = new URL(request.url);
  if (isPublicApi(pathname)) return next();

  const nonce = createNonce();
  const headers = securityHeaders({ nonce, dev: import.meta.env.DEV });
  if (!isAllowedOrigin(request)) return new Response("Forbidden", { status: 403, headers });

  const { workspace, session } = await readSession(request);
  const decision = gate({
    pathname,
    isServerFn: handlerType === "serverFn",
    hasPassword: Boolean(workspace?.passwordHash),
    setupPending: isSetupPending(workspace, Date.now()),
    hasSession: session !== null,
  });
  if (decision.type === "unauthorized") return new Response("Unauthorized", { status: 401, headers });
  if (decision.type === "redirect") {
    return new Response(null, { status: 303, headers: { ...headers, Location: decision.to } });
  }

  const result = await next({ context: { nonce } });
  for (const [name, value] of Object.entries(headers)) result.response.headers.set(name, value);
  return result;
});
