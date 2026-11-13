import { OFFER_SORTS, OFFER_STATUSES, type OfferSort, type OfferStatus } from "@deparked/db";
import { Button } from "@deparked/ui/button";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { HandCoins, SearchX } from "lucide-react";
import { oneOf } from "../../../components/messages";
import { filteredEmptyTitle, offerParam } from "../../../components/offer-copy";
import { NoOffers, OfferFilters, OffersPending, OffersView } from "../../../components/offer-list";
import { PageError } from "../../../components/page";
import { getOffers } from "../../../server/offers.functions";

export const Route = createFileRoute("/admin/_shell/d/$host/offers")({
  validateSearch: (
    search,
  ): { status?: OfferStatus | undefined; sort?: OfferSort | undefined; offer?: string | undefined } => ({
    status: oneOf(search.status, OFFER_STATUSES),
    sort: oneOf(search.sort, OFFER_SORTS),
    offer: offerParam(search.offer),
  }),
  loaderDeps: ({ search }) => ({ status: search.status, sort: search.sort }),
  loader: ({ params, deps, location }) =>
    getOffers({
      data: { host: params.host, ...deps, selected: offerParam(new URLSearchParams(location.searchStr).get("offer")) },
    }),
  component: DomainOffersPage,
  pendingComponent: OffersPending,
  errorComponent: PageError,
});

const domainRoute = Route.parentRoute;

function DomainOffersPage() {
  const { host } = Route.useParams();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const { domain } = domainRoute.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const back = useRouterState({ select: (state) => `${state.location.pathname}${state.location.searchStr}` });
  const query = { host, status: search.status, sort: search.sort };

  const live = domain.status === "live" || domain.status === "email_pending";
  const empty = !data.anyOffers ? (
    <NoOffers
      icon={<HandCoins className="size-6" strokeWidth={1.5} />}
      title={`No offers for ${host} yet`}
      description={
        live
          ? "Its page is live and takes offers. Each one shows up here, and in your email, the moment a visitor sends it."
          : "Offers come from its for-sale page once that page is live."
      }
      action={
        live ? (
          <Button asChild variant="outline" size="lg">
            <a href={`https://${host}/`} target="_blank" rel="noreferrer">
              See the page as visitors do
            </a>
          </Button>
        ) : (
          <Button asChild variant="accent" size="lg">
            <Link to="/admin/d/$host" params={{ host }}>
              Open the page editor
            </Link>
          </Button>
        )
      }
    />
  ) : (
    <NoOffers
      icon={<SearchX className="size-6" strokeWidth={1.5} />}
      title={filteredEmptyTitle({ status: search.status })}
      description="Other offers for this domain are under another status."
      action={
        <Button asChild variant="outline" size="lg">
          <Link to="/admin/d/$host/offers" params={{ host }}>
            Show all its offers
          </Link>
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col gap-5">
      {data.anyOffers ? (
        <OfferFilters
          query={query}
          newCount={data.newCount}
          onChange={(next) => void navigate({ search: { status: next.status, sort: next.sort } })}
        />
      ) : null}
      <OffersView
        key={`${search.status ?? ""}|${search.sort ?? ""}`}
        data={data}
        query={query}
        selectedId={search.offer}
        showHost={false}
        back={back}
        empty={empty}
      />
    </div>
  );
}
