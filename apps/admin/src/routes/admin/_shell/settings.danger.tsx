import { Button } from "@deparked/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "../../../components/page";

export const Route = createFileRoute("/admin/_shell/settings/danger")({
  head: () => ({ meta: [{ title: "Danger zone · Deparked" }] }),
  component: () => (
    <div className="flex flex-col gap-6">
      <ComingSoon
        title="Remove a domain"
        action={
          <Button variant="destructive" disabled>
            Remove domain
          </Button>
        }
      >
        Takes a domain out of Deparked and undoes everything Deparked set up for it. Not built yet.
      </ComingSoon>
      <ComingSoon
        title="Uninstall Deparked"
        action={
          <Button variant="destructive" disabled>
            Uninstall
          </Button>
        }
      >
        Exports the offers, then deletes everything Deparked created in your Cloudflare account. Not built yet.
      </ComingSoon>
    </div>
  ),
});
