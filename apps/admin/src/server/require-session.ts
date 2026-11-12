import { redirect } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { LOGIN_PATH } from "./auth/gate";
import type { Session } from "./auth/session";
import { readSession } from "./request";

/**
 * For server functions and server route handlers that need a logged-in owner: call it first, inside the handler.
 * The global middleware already turns anonymous requests away; this is the check at the data itself, and it also
 * covers a function called in-process during server rendering, which no request middleware sees.
 */
export async function requireSession(): Promise<Session> {
  const { session } = await readSession(getRequest());
  if (session === null) throw redirect({ href: LOGIN_PATH });
  return session;
}
