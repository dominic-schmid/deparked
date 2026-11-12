import { OFFER_SORTS, OFFER_STATUSES, type OfferSort, type OfferStatus } from "@deparked/db";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useId } from "react";
import { oneOf } from "../../../components/messages";
import {
  ExportButton,
  NoOffers,
  OfferList,
  SELECT_CLASS,
  SortSelect,
  STATUS_FILTERS,
} from "../../../components/offer-list";
import { PageError, PageHeader, PagePending, TabNav, tabLinkClass } from "../../../components/page";
import { getOffers } from "../../../server/offers.functions";

export const Route = createFileRoute("/admin/_shell/inbox")({
  validateSearch: (
    search,
  ): { status?: OfferStatus | undefined; host?: string | undefined; sort?: OfferSort | undefined } => ({
    status: oneOf(search.status, OFFER_STATUSES),
    host: typeof search.host === "string" && search.host !== "" ? search.host : undefined,
    sort: oneOf(search.sort, OFFER_SORTS),
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
        description={`Offers from every domain, ${filter.sort === "highest" ? "highest" : "newest"} first.`}
        actions={<ExportButton filter={filter} />}
      />
      <div className="mb-4 grid gap-3 sm:max-w-xl sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={selectId} className="text-sm font-medium">
            Domain
          </label>
          <select
            id={selectId}
            value={filter.host ?? ""}
            onChange={(event) =>
              void navigate({ search: (previous) => ({ ...previous, host: event.target.value || undefined }) })
            }
            className={SELECT_CLASS}
          >
            <option value="">All domains</option>
            {domains.map((domain) => (
              <option key={domain.host} value={domain.host}>
                {domain.host}
              </option>
            ))}
          </select>
        </div>
        <SortSelect
          value={filter.sort}
          onChange={(sort) => void navigate({ search: (previous) => ({ ...previous, sort }) })}
        />
      </div>
      <TabNav label="Filter by status">
        {STATUS_FILTERS.map((item) => (
          <Link
            key={item.label}
            to="/admin/inbox"
            search={{ status: item.status, host: filter.host, sort: filter.sort }}
            activeOptions={{ exact: true, includeSearch: true }}
            className={tabLinkClass}
          >
            {item.label}
          </Link>
        ))}
      </TabNav>
      <OfferList
        key={`${filter.host ?? ""}|${filter.status ?? ""}|${filter.sort ?? ""}`}
        first={first}
        filter={filter}
        showHost
        empty={<NoOffers filtered={filter.host !== undefined || filter.status !== undefined} />}
      />
    </>
  );
}
