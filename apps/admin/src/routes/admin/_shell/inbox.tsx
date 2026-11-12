import { OFFER_STATUSES, type OfferStatus } from "@deparked/db";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useId } from "react";
import { oneOf } from "../../../components/messages";
import { ExportButton, NoOffers, OfferList, STATUS_FILTERS } from "../../../components/offer-list";
import { PageError, PageHeader, PagePending, TabNav, tabLinkClass } from "../../../components/page";
import { getOffers } from "../../../server/offers.functions";

export const Route = createFileRoute("/admin/_shell/inbox")({
  validateSearch: (search): { status?: OfferStatus | undefined; host?: string | undefined } => ({
    status: oneOf(search.status, OFFER_STATUSES),
    host: typeof search.host === "string" && search.host !== "" ? search.host : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getOffers({ data: deps }),
  head: () => ({ meta: [{ title: "Inbox · Deparked" }] }),
  component: InboxPage,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

const shellRoute = Route.parentRoute;

function InboxPage() {
  const filter = Route.useSearch();
  const first = Route.useLoaderData();
  const { domains } = shellRoute.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const selectId = useId();

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Offers from every domain, newest first."
        actions={<ExportButton filter={filter} />}
      />
      <div className="mb-4 flex flex-col gap-1.5 sm:max-w-xs">
        <label htmlFor={selectId} className="text-sm font-medium">
          Domain
        </label>
        <select
          id={selectId}
          value={filter.host ?? ""}
          onChange={(event) =>
            void navigate({ search: (previous) => ({ ...previous, host: event.target.value || undefined }) })
          }
          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="">All domains</option>
          {domains.map((domain) => (
            <option key={domain.host} value={domain.host}>
              {domain.host}
            </option>
          ))}
        </select>
      </div>
      <TabNav label="Filter by status">
        {STATUS_FILTERS.map((item) => (
          <Link
            key={item.label}
            to="/admin/inbox"
            search={{ status: item.status, host: filter.host }}
            activeOptions={{ exact: true, includeSearch: true }}
            className={tabLinkClass}
          >
            {item.label}
          </Link>
        ))}
      </TabNav>
      <OfferList
        key={`${filter.host ?? ""}|${filter.status ?? ""}`}
        first={first}
        filter={filter}
        showHost
        empty={<NoOffers filtered={filter.host !== undefined || filter.status !== undefined} />}
      />
    </>
  );
}
