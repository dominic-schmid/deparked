import { bumpSessionVersion } from "@deparked/db";
import { createFileRoute } from "@tanstack/react-router";
import { clearedSessionCookie } from "../../../server/auth/session";
import { authRequest, seeOther } from "../../../server/request";
import { requireSession } from "../../../server/require-session";

// Ends every session, this one included: a cookie copied from any browser stops working.
export const Route = createFileRoute("/admin/settings/logout-everywhere")({
  server: {
    handlers: {
      GET: () => seeOther("/admin/settings/password"),
      POST: async ({ request }) => {
        await requireSession();
        const { db, url, now } = authRequest(request);
        await bumpSessionVersion(db, now);
        return seeOther("/admin/login", clearedSessionCookie(url));
      },
    },
  },
});
