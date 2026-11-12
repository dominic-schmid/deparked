import { env } from "cloudflare:workers";
import { createDb } from "@deparked/db";
import { createFileRoute } from "@tanstack/react-router";
import { exportFilename, exportOffers, offerFilterSchema, offersCsv } from "../../server/offers";
import { requireSession } from "../../server/require-session";

// The inbox's "Export CSV": every offer the filter (`?host=`, `?status=`) matches, as a download.
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
        const csv = offersCsv(await exportOffers(createDb(env.DB), filter.data));
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${exportFilename(filter.data, Date.now())}"`,
          },
        });
      },
    },
  },
});
