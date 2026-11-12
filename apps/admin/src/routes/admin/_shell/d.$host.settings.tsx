import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { DomainActions } from "../../../components/domain-actions";
import { NotifyPicker } from "../../../components/notify-picker";
import { PageError, PagePending } from "../../../components/page";
import { getNotifyAddresses } from "../../../server/notify.functions";

const domainRoute = getRouteApi("/admin/_shell/d/$host");

export const Route = createFileRoute("/admin/_shell/d/$host/settings")({
  loader: () => getNotifyAddresses(),
  component: DomainSettings,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

function DomainSettings() {
  const { domain } = domainRoute.useLoaderData();
  const { addresses } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <NotifyPicker host={domain.host} current={domain.notifyEmail} addresses={addresses} />
      <DomainActions host={domain.host} status={domain.status} hasPages={domain.hasPages} />
    </div>
  );
}
