import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "../../../components/page";

export const Route = createFileRoute("/admin/_shell/d/$host/")({
  component: () => (
    <ComingSoon title="Editor">
      The page editor with its live preview arrives with the editor PR. Until then this domain shows its placeholder
      page.
    </ComingSoon>
  ),
});
