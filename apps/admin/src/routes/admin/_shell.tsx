import { createFileRoute, Outlet } from "@tanstack/react-router";
import { UntilHydrated } from "../../components/hydrated";
import { PageError, PagePending } from "../../components/page";
import { AppShell } from "../../components/shell";
import { getShell } from "../../server/domains.functions";

// Every logged-in screen. The middleware already keeps anonymous requests out; `getShell` checks again.
export const Route = createFileRoute("/admin/_shell")({
  loader: () => getShell(),
  // The inbox badge and the status dots must not lag behind what the page under them shows.
  staleTime: 0,
  component: Shell,
  errorComponent: () => (
    <main className="mx-auto max-w-xl p-4 sm:p-8">
      <PageError />
    </main>
  ),
  pendingComponent: PagePending,
});

function Shell() {
  return (
    <UntilHydrated>
      <AppShell data={Route.useLoaderData()}>
        <Outlet />
      </AppShell>
    </UntilHydrated>
  );
}
