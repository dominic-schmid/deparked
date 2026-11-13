import { EmptyState } from "@deparked/ui/arc/empty-state";
import { Button } from "@deparked/ui/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Store } from "lucide-react";
import { useState } from "react";
import { AnalyticsProblemAlert } from "../../../components/analytics";
import {
  AddDomainCard,
  BestOfferCard,
  DomainTable,
  Greeting,
  ViewSwitch,
  VisitsCard,
  WindowCard,
} from "../../../components/home";
import { homeHeadline, statusSummary } from "../../../components/home-copy";
import { PageError, PagePending } from "../../../components/page";
import { SetupChecklistCard } from "../../../components/setup-checklist";
import { getAnalytics, getOverview } from "../../../server/domains.functions";

export const Route = createFileRoute("/admin/_shell/")({
  loader: async () => {
    const [overview, visits] = await Promise.all([getOverview(), getAnalytics()]);
    return { ...overview, visits };
  },
  head: () => ({ meta: [{ title: "Domains · Deparked" }] }),
  component: HomePage,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

function HomePage() {
  const { domains, visits, checklist, bestOffer, view: savedView, now } = Route.useLoaderData();
  const [view, setView] = useState(savedView);
  const waiting = domains.reduce((sum, domain) => sum + domain.newOffers, 0);
  const empty = domains.length === 0;

  const side = bestOffer ? (
    <BestOfferCard offer={bestOffer} now={now} waiting={waiting} />
  ) : empty ? (
    <EmptyState
      title="No domains yet"
      description="Each domain you add gets its own for-sale page and an offer form."
      icon={<Store className="size-6" strokeWidth={1.5} />}
      className="rounded-[28px] bg-card shadow-lift"
      action={
        <Button asChild variant="accent" size="lg">
          <Link to="/admin/add">
            <Plus aria-hidden="true" />
            Add a domain
          </Link>
        </Button>
      }
    />
  ) : (
    <VisitsCard visits={visits} />
  );

  return (
    <div className="flex flex-col gap-9">
      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col justify-center gap-2.5">
          <Greeting />
          <h1 className="font-heading text-[clamp(2.25rem,1.5rem+2.8vw,3.25rem)] leading-[1.04] font-bold tracking-[-0.02em] text-balance [overflow-wrap:anywhere]">
            {homeHeadline(domains)}
          </h1>
          <p className="text-[17px] text-pretty text-muted-foreground">{statusSummary(domains)}</p>
        </div>
        {side}
      </div>

      {checklist === null ? null : <SetupChecklistCard checklist={checklist} />}

      {empty ? null : (
        <section aria-labelledby="all-domains" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="all-domains" className="font-heading text-xl font-bold tracking-[-0.01em]">
              All domains{" "}
              <span className="font-sans text-base font-medium text-muted-foreground tabular-nums">
                {domains.length.toLocaleString("en")}
              </span>
            </h2>
            <ViewSwitch view={view} onChange={setView} />
          </div>
          {visits.ok ? null : <AnalyticsProblemAlert problem={visits.problem} />}
          {view === "list" ? (
            <DomainTable domains={domains} visits={visits} now={now} />
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,250px),1fr))] gap-5">
              {domains.map((domain) => (
                <li key={domain.host} className="flex min-w-0 flex-col [&>*]:flex-1">
                  <WindowCard domain={domain} visits={visits} />
                </li>
              ))}
              <li className="flex flex-col [&>*]:flex-1">
                <AddDomainCard />
              </li>
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
