import { env } from "cloudflare:workers";
import { createDb } from "@deparked/db";
import { createFileRoute } from "@tanstack/react-router";
import { createHosting } from "../../server/hosting";
import { handleOffer } from "../../server/offer/http";

// Public: the global middleware lets `/api/*` through untouched, so every check is in `handleOffer`.
export const Route = createFileRoute("/api/offer")({
  server: {
    handlers: {
      ANY: ({ request }) =>
        handleOffer(request, {
          db: createDb(env.DB),
          hosting: createHosting(),
          sessionKey: env.SESSION_KEY,
          now: Date.now(),
        }),
    },
  },
});
