import { env } from "cloudflare:workers";
import { createDb, setWorkspaceMark } from "@deparked/db";
import { createFileRoute } from "@tanstack/react-router";
import { exportFilename, exportOffers, offerFilterSchema, offersCsv } from "../../server/offers";
import { requireSession } from "../../server/require-session";

// The inbox's "Export CSV": every offer the filter (`?host=`, `?status=`) matches, as a download. An unfiltered,
// complete one is recorded as the copy Uninstall asks for.
export const Route = createFileRoute("/admin/offers.csv")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await requireSession();
        const search = new URL(request.url).searchParams;
        const filter = offerFilterSchema.safeParse({
          host: search.get("host") ?? undefined,
          status: search.get("status") ?? undefined,
        });
        if (!filter.success) return new Response("Bad request", { status: 400 });
        const db = createDb(env.DB);
        const data = await exportOffers(db, filter.data);
        // A download of every offer is the copy Uninstall asks for.
        if (filter.data.host === undefined && filter.data.status === undefined && !data.truncated) {
          await setWorkspaceMark(db, { mark: "offers-exported", now: Date.now() });
        }
        return new Response(offersCsv(data), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${exportFilename(filter.data, Date.now())}"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            ...(data.truncated ? { "X-Deparked-Truncated": "1" } : {}),
          },
        });
      },
    },
  },
});
