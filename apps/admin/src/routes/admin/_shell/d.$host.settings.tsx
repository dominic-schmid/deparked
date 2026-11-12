import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { DomainActions } from "../../../components/domain-actions";

const domainRoute = getRouteApi("/admin/_shell/d/$host");

export const Route = createFileRoute("/admin/_shell/d/$host/settings")({
  component: DomainSettings,
});

function DomainSettings() {
  const { domain } = domainRoute.useLoaderData();
  return <DomainActions host={domain.host} status={domain.status} hasPages={domain.hasPages} />;
}
