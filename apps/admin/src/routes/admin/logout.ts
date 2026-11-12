import { createFileRoute } from "@tanstack/react-router";
import { clearedSessionCookie } from "../../server/auth/session";
import { seeOther } from "../../server/request";

// Ends this browser's session. Sessions elsewhere end when the password changes.
export const Route = createFileRoute("/admin/logout")({
  server: {
    handlers: {
      GET: () => seeOther("/admin"),
      POST: ({ request }) => seeOther("/admin/login", clearedSessionCookie(new URL(request.url))),
    },
  },
});
