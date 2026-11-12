import { Button } from "@deparked/ui/button";
import { createFileRoute, Link, notFound, Outlet } from "@tanstack/react-router";
import { OfferMailNotice } from "../../../components/offer-mail";
import { PageError, PagePending, TabNav, tabLinkClass } from "../../../components/page";
import { StatusLabel } from "../../../components/status";
import { RelativeTime } from "../../../components/time";
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

function DomainLayout() {
  const { domain, now } = Route.useLoaderData();
  const params = { host: domain.host };
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{domain.host}</h1>
        <dl className="mt-3 flex flex-col gap-x-8 gap-y-2 text-sm sm:flex-row sm:flex-wrap">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <StatusLabel status={domain.status} />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Last published</dt>
            <dd>{domain.publishedAt === null ? "Never" : <RelativeTime time={domain.publishedAt} now={now} />}</dd>
          </div>
          <div className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-muted-foreground">Offers go to</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">
              {domain.notifyEmail === null ? (
                <span className="text-muted-foreground">No address yet</span>
              ) : (
                <>
                  <span translate="no">{domain.notifyEmail}</span>
                  {domain.notifyVerified ? null : <span className="text-muted-foreground"> (not verified yet)</span>}
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>
      {domain.status === "off" ? null : <OfferMailNotice host={domain.host} mail={domain.mail} />}
      <TabNav label="Domain">
        <Link to="/admin/d/$host" params={params} activeOptions={{ exact: true }} className={tabLinkClass}>
          Editor
        </Link>
        <Link to="/admin/d/$host/offers" params={params} className={tabLinkClass}>
          Offers
        </Link>
        <Link to="/admin/d/$host/analytics" params={params} className={tabLinkClass}>
          Analytics
        </Link>
        <Link to="/admin/d/$host/settings" params={params} className={tabLinkClass}>
          Settings
        </Link>
      </TabNav>
      <Outlet />
    </>
  );
}
