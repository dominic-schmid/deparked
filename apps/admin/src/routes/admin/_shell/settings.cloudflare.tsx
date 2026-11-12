import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "../../../components/page";

export const Route = createFileRoute("/admin/_shell/settings/cloudflare")({
  head: () => ({ meta: [{ title: "Cloudflare token · Deparked" }] }),
  component: () => (
    <ComingSoon
      title="Cloudflare token"
      action={
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">State unknown</Badge>
          <Button variant="outline" disabled>
            Replace token
          </Button>
        </div>
      }
    >
      Deparked uses the token you pasted during the install to publish pages and set up domains. Checking its state and
      replacing it arrive in a later release.
    </ComingSoon>
  ),
});
