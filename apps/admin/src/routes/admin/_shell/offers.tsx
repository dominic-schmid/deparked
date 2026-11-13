import { OFFER_SORTS, OFFER_STATUSES, type OfferSort, type OfferStatus } from "@deparked/db";
import { Button } from "@deparked/ui/button";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { HandCoins, SearchX } from "lucide-react";
import { oneOf } from "../../../components/messages";
import { filteredEmptyTitle, offerParam } from "../../../components/offer-copy";
import { NoOffers, OfferFilters, OffersPending, OffersView } from "../../../components/offer-list";
import { PageError } from "../../../components/page";
import { getOffers } from "../../../server/offers.functions";

export type OffersSearch = {
  status?: OfferStatus | undefined;
  host?: string | undefined;
  sort?: OfferSort | undefined;
  offer?: string | undefined;
};

export const Route = createFileRoute("/admin/_shell/offers")({
  validateSearch: (search): OffersSearch => ({
    status: oneOf(search.status, OFFER_STATUSES),
    host: typeof search.host === "string" && search.host !== "" ? search.host : undefined,
    sort: oneOf(search.sort, OFFER_SORTS),
    offer: offerParam(search.offer),
  }),
  // The list depends on the filter only: picking another offer changes `?offer=` without reloading it.
  loaderDeps: ({ search }) => ({ status: search.status, host: search.host, sort: search.sort }),
  loader: ({ deps, location }) =>
    getOffers({ data: { ...deps, selected: offerParam(new URLSearchParams(location.searchStr).get("offer")) } }),
  head: () => ({ meta: [{ title: "Offers · Deparked" }] }),
  component: OffersPage,
  pendingComponent: OffersPending,
  errorComponent: PageError,
});

const shellRoute = Route.parentRoute;

function OffersPage() {
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const { domains } = shellRoute.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const back = useRouterState({ select: (state) => `${state.location.pathname}${state.location.searchStr}` });
  const query = { status: search.status, host: search.host, sort: search.sort };
  // A page that takes offers, emailed or not yet.
  const live = domains.find((domain) => domain.status === "live" || domain.status === "email_pending");

  const empty = !data.anyOffers ? (
    <NoOffers
      icon={<HandCoins className="size-6" strokeWidth={1.5} />}
      title="No offers yet"
      description={
        domains.length === 0
          ? "Offers come from a domain's for-sale page. Add a domain and put its page live."
          : live === undefined
            ? "Offers come from a live for-sale page, and none of your pages is live yet."
            : "Your live pages take offers. Each one shows up here, and in your email, the moment a visitor sends it."
      }
      action={
        domains.length === 0 ? (
          <Button asChild variant="accent" size="lg">
            <Link to="/admin/add">Add a domain</Link>
          </Button>
        ) : live === undefined ? (
          <Button asChild variant="accent" size="lg">
            <Link to="/admin">Put a page live</Link>
          </Button>
        ) : (
          <Button asChild variant="outline" size="lg">
            <a href={`https://${live.host}/`} target="_blank" rel="noreferrer">
              See {live.host} as visitors do
            </a>
          </Button>
        )
      }
    />
  ) : (
    <NoOffers
      icon={<SearchX className="size-6" strokeWidth={1.5} />}
      title={filteredEmptyTitle(query)}
      description="Other offers are under another status or domain."
      action={
        <Button asChild variant="outline" size="lg">
          <Link to="/admin/offers">Show all offers</Link>
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="font-heading text-4xl font-bold tracking-[-0.02em]">Offers</h1>
        {data.anyOffers ? (
          <OfferFilters
            query={query}
            newCount={data.newCount}
            hosts={domains.map((domain) => domain.host)}
            onChange={(next) => void navigate({ search: { ...next, offer: undefined } })}
          />
        ) : null}
      </div>
      <OffersView
        key={`${search.host ?? ""}|${search.status ?? ""}|${search.sort ?? ""}`}
        data={data}
        query={query}
        selectedId={search.offer}
        showHost
        back={back}
        empty={empty}
      />
    </div>
  );
}
