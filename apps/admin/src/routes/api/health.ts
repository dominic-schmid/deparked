import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { readSession } from "../../server/request";

const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex" };

// The health check an update waits for: a plain path every version serves the same way, so the page of the old
// admin can ask the new one. It reads the database, and tells only a logged-in owner which release answers.
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
