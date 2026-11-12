import { OFFER_SORTS, OFFER_STATUSES, type OfferSort, type OfferStatus } from "@deparked/db";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { oneOf } from "../../../components/messages";
import { ExportButton, NoOffers, OfferList, SortSelect, STATUS_FILTERS } from "../../../components/offer-list";
import { PageError, PagePending } from "../../../components/page";
import { getOffers } from "../../../server/offers.functions";

export const Route = createFileRoute("/admin/_shell/d/$host/offers")({
  validateSearch: (search): { status?: OfferStatus | undefined; sort?: OfferSort | undefined } => ({
    status: oneOf(search.status, OFFER_STATUSES),
    sort: oneOf(search.sort, OFFER_SORTS),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => getOffers({ data: { host: params.host, status: deps.status, sort: deps.sort } }),
  component: DomainOffersPage,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

const FILTER_LINK =
  "rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-secondary aria-[current=page]:text-foreground";

function DomainOffersPage() {
  const { host } = Route.useParams();
  const { status, sort } = Route.useSearch();
  const first = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const filter = { host, status };
  return (
    <>
      <div className="mb-4 sm:max-w-xs">
        <SortSelect
          value={sort}
          onChange={(next) => void navigate({ search: (previous) => ({ ...previous, sort: next }) })}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((item) => (
            <Link
              key={item.label}
              to="/admin/d/$host/offers"
              params={{ host }}
              search={{ status: item.status, sort }}
              activeOptions={{ exact: true, includeSearch: true }}
              className={FILTER_LINK}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <ExportButton filter={filter} />
      </div>
      <OfferList
        key={`${host}|${status ?? ""}|${sort ?? ""}`}
        first={first}
        filter={{ ...filter, sort }}
        showHost={false}
        empty={<NoOffers filtered={status !== undefined} />}
      />
    </>
  );
}
