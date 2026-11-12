import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "../../../components/page";

export const Route = createFileRoute("/admin/_shell/settings/updates")({
  head: () => ({ meta: [{ title: "Updates · Deparked" }] }),
  component: () => (
    <ComingSoon title="Updates">
      Checking for a newer release of Deparked and installing it from here arrive in a later release.
    </ComingSoon>
  ),
});
