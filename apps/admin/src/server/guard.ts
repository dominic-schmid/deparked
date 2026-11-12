import { createMiddleware } from "@tanstack/react-start";
import { isSetupPending } from "./auth/account";
import { gate, isPublicApi, isSetupPath, SETUP_PATH } from "./auth/gate";
import { createNonce, securityHeaders } from "./auth/headers";
import { isAllowedOrigin } from "./auth/origin";
import { httpsRedirect, setupSecretCookie } from "./auth/session";
import { readSession } from "./request";

/**
 * The one global request middleware. It runs before every page, server route and server function, in this order:
 *
 * 1. `/api/*` passes untouched (public; those routes do their own checks).
 * 2. Plain http is redirected to https (308), except on localhost.
 * 3. Origin check on state-changing methods: 403.
 * 4. A setup link's `?secret=` is moved into a short-lived cookie and the URL is redirected clean.
 * 5. Auth gate (default deny, see `gate`): redirect to login or setup, or 401 for a server function.
 * 6. The handler runs, with the CSP nonce in its context.
 * 7. Security headers go on whatever response comes back, including the 403, 401 and redirects.
 */
export const adminGuard = createMiddleware().server(async ({ request, handlerType, next }) => {
  const url = new URL(request.url);
  const { pathname } = url;
  if (isPublicApi(pathname)) return next();

  const nonce = createNonce();
  const headers = securityHeaders({ nonce, dev: import.meta.env.DEV, setup: isSetupPath(pathname) });
  const https = httpsRedirect(url);
  if (https !== null) return new Response(null, { status: 308, headers: { ...headers, Location: https } });
  if (!isAllowedOrigin(request)) return new Response("Forbidden", { status: 403, headers });

  const linkSecret = request.method === "GET" && isSetupPath(pathname) ? url.searchParams.get("secret") : null;
  if (linkSecret !== null) {
    const setCookie = setupSecretCookie(url, linkSecret);
    return new Response(null, {
      status: 303,
      headers: {
        ...headers,
        Location: setCookie === null ? SETUP_PATH : `${SETUP_PATH}?link=1`,
        ...(setCookie === null ? {} : { "Set-Cookie": setCookie }),
      },
    });
  }

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
