import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "../../../components/page";

export const Route = createFileRoute("/admin/_shell/d/$host/settings")({
  component: () => (
    <ComingSoon title="Domain settings">
      Choosing the notify address, turning the domain off and on again, and removing it arrive in a later release.
    </ComingSoon>
  ),
});
