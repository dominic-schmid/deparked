import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { readSession } from "../../server/request";

const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex" };

// The health check an update waits for. A plain path, not a server function, so the page an older admin served
// can still call it once a newer admin has replaced it, and learn which release answers. It reads the workspace
// row (the database works), and tells the release only to a logged-in owner.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { session } = await readSession(request);
        if (session === null) return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
        const release = (env as unknown as Record<string, unknown>).DEPARKED_RELEASE;
        return Response.json(
          { ok: true, release: typeof release === "string" && release !== "" ? release : null },
          { headers: NO_STORE },
        );
      },
    },
  },
});
