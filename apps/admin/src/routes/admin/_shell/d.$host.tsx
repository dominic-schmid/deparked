import { Button } from "@deparked/ui/button";
import { createFileRoute, Link, notFound, Outlet, useMatch } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { OfferMailBadge } from "../../../components/offer-mail";
import { PageError, PagePending } from "../../../components/page";
import { PendingChangeNotice } from "../../../components/pending-change";
import { NewOffersCount, PILL } from "../../../components/shell";
import { StatusLabel } from "../../../components/status";
import { getDomainDetail } from "../../../server/domains.functions";

export const Route = createFileRoute("/admin/_shell/d/$host")({
  loader: async ({ params }) => {
    const { domain, now } = await getDomainDetail({ data: { host: params.host } });
    if (domain === null) throw notFound();
    return { domain, now };
  },
  head: ({ params }) => ({ meta: [{ title: `${params.host} · Deparked` }] }),
  component: DomainLayout,
  notFoundComponent: UnknownDomain,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

function UnknownDomain() {
  const { host } = Route.useParams();
  return (
    <div className="mx-auto mt-12 flex max-w-md flex-col items-center gap-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Domain not found</h1>
      <p className="text-muted-foreground [overflow-wrap:anywhere]">
        {host} is not one of the domains this workspace manages.
      </p>
      <Button asChild variant="outline">
        <Link to="/admin">Back to all domains</Link>
      </Button>
    </div>
  );
}

/**
 * The frame of a domain's pages: back to all domains, its name, its sections as pills. One grid holds the header and
 * the page below it, so the Page tab can put its save state and its one main action into the header row (the
 * editor's own `DOMAIN_ACTIONS` element); every other child spans the full width under the header.
 */
function DomainLayout() {
  const { domain } = Route.useLoaderData();
  const params = { host: domain.host };
  const page = useMatch({ from: "/admin/_shell/d/$host/", shouldThrow: false }) !== undefined;
  const mailProblem = domain.status !== "off" && domain.mail.state !== "ok";
  const quiet = domain.status === "live" || domain.status === "draft";
  return (
    <div
      data-page={page || undefined}
      className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-6 gap-y-4 [grid-template-areas:'title'_'nav'] data-page:[grid-template-areas:'title'_'nav'_'actions'] md:grid-cols-[minmax(0,1fr)_auto] md:[grid-template-areas:'title_title'_'nav_nav'] md:data-page:[grid-template-areas:'title_actions'_'nav_nav'] xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] xl:[grid-template-areas:'title_nav_.'] xl:data-page:[grid-template-areas:'title_nav_actions']"
    >
      <div className="flex min-w-0 items-center gap-3 [grid-area:title]">
        <Link
          to="/admin"
          aria-label="Back to domains"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-card shadow-rest outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
        </Link>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1
            translate="no"
            className="font-heading text-[22px] leading-tight font-bold tracking-[-0.01em] [overflow-wrap:anywhere]"
          >
            {domain.host}
          </h1>
          {quiet && !mailProblem ? null : (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {quiet ? null : <StatusLabel status={domain.status} />}
              {mailProblem ? <OfferMailBadge host={domain.host} mail={domain.mail} /> : null}
            </p>
          )}
        </div>
      </div>
      <nav
        aria-label="Domain"
        className="flex min-w-0 gap-1 justify-self-start rounded-full bg-card p-1 shadow-rest [grid-area:nav] max-sm:w-full max-sm:justify-self-stretch xl:justify-self-center"
      >
        <Link to="/admin/d/$host" params={params} activeOptions={{ exact: true }} className={PILL}>
          Page
        </Link>
        <Link to="/admin/d/$host/offers" params={params} className={PILL}>
          Offers
          <NewOffersCount count={domain.newOffers} />
        </Link>
        <Link to="/admin/d/$host/analytics" params={params} className={PILL}>
          Visits
        </Link>
        <Link to="/admin/d/$host/settings" params={params} className={PILL}>
          Settings
        </Link>
      </nav>
      {domain.pending === null ? null : (
        <div className="col-span-full min-w-0 [&>*]:mb-0!">
          <PendingChangeNotice host={domain.host} pending={domain.pending} />
        </div>
      )}
      {/* The Page tab's children are grid items themselves (see `DOMAIN_ACTIONS`); other tabs are one block. */}
      <div className={page ? "contents *:col-span-full" : "col-span-full mt-2 min-w-0"}>
        <Outlet />
      </div>
    </div>
  );
}
