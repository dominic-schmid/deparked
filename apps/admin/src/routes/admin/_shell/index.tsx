import { Button } from "@deparked/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@deparked/ui/table";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { formatMoney } from "../../../components/format";
import { PageError, PageHeader, PagePending } from "../../../components/page";
import { StatusLabel } from "../../../components/status";
import { RelativeTime } from "../../../components/time";
import type { DomainOverview } from "../../../server/domains";
import { getAnalytics, getOverview, type Visits } from "../../../server/domains.functions";

export const Route = createFileRoute("/admin/_shell/")({
  loader: async () => {
    const [overview, visits] = await Promise.all([getOverview(), getAnalytics()]);
    return { ...overview, visits };
  },
  head: () => ({ meta: [{ title: "All domains · Deparked" }] }),
  component: OverviewPage,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

const HOST_LINK =
  "rounded-sm font-medium underline-offset-4 outline-none [overflow-wrap:anywhere] hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50";

function AddDomainButton() {
  return (
    <Button asChild>
      <Link to="/admin/add">
        <Plus aria-hidden="true" />
        Add domain
      </Link>
    </Button>
  );
}

function VisitsCell({ visits }: { visits: Visits[string] | undefined }) {
  if (visits === undefined) return <span className="text-muted-foreground">No data yet</span>;
  return (
    <span className="tabular-nums">
      {visits.last7.toLocaleString("en")} / {visits.last30.toLocaleString("en")}
    </span>
  );
}

function OffersCell({ domain }: { domain: DomainOverview }) {
  if (domain.offers === 0) return <span className="text-muted-foreground">None</span>;
  return (
    <Link
      to="/admin/d/$host/offers"
      params={{ host: domain.host }}
      className="rounded-sm tabular-nums underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {domain.offers.toLocaleString("en")}
      {domain.newOffers > 0 ? ` (${domain.newOffers.toLocaleString("en")} new)` : ""}
    </Link>
  );
}

function BestCell({ best }: { best: DomainOverview["best"] }) {
  if (best === null) return <span className="text-muted-foreground">None</span>;
  return <span className="tabular-nums [overflow-wrap:anywhere]">{formatMoney(best.amountMinor, best.currency)}</span>;
}

function PublishedCell({ time, now }: { time: number | null; now: number }) {
  if (time === null) return <span className="text-muted-foreground">Never</span>;
  return <RelativeTime time={time} now={now} />;
}

function OverviewPage() {
  const { domains, visits, now } = Route.useLoaderData();

  if (domains.length === 0) {
    return (
      <div className="mx-auto mt-12 flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">No domains yet</h1>
        <p className="text-muted-foreground">
          Add a domain from your Cloudflare account to give it a for-sale page and an offer form.
        </p>
        <AddDomainButton />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="All domains"
        description={domains.length === 1 ? "1 domain" : `${domains.length} domains`}
        actions={<AddDomainButton />}
      />
      <div className="hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Domain</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col">Visits, 7 / 30 days</TableHead>
              <TableHead scope="col">Offers</TableHead>
              <TableHead scope="col">Best offer</TableHead>
              <TableHead scope="col">Last published</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domains.map((domain) => (
              <TableRow key={domain.host}>
                <TableHead scope="row" className="max-w-72 py-3 whitespace-normal">
                  <Link to="/admin/d/$host" params={{ host: domain.host }} className={HOST_LINK}>
                    {domain.host}
                  </Link>
                </TableHead>
                <TableCell>
                  <StatusLabel status={domain.status} />
                </TableCell>
                <TableCell>
                  <VisitsCell visits={visits[domain.host]} />
                </TableCell>
                <TableCell>
                  <OffersCell domain={domain} />
                </TableCell>
                <TableCell className="max-w-48 whitespace-normal">
                  <BestCell best={domain.best} />
                </TableCell>
                <TableCell>
                  <PublishedCell time={domain.publishedAt} now={now} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col gap-3 md:hidden">
        {domains.map((domain) => (
          <li key={domain.host} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Link to="/admin/d/$host" params={{ host: domain.host }} className={`min-w-0 ${HOST_LINK}`}>
                {domain.host}
              </Link>
              <StatusLabel status={domain.status} />
            </div>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Visits, 7 / 30 days</dt>
              <dd>
                <VisitsCell visits={visits[domain.host]} />
              </dd>
              <dt className="text-muted-foreground">Offers</dt>
              <dd>
                <OffersCell domain={domain} />
              </dd>
              <dt className="text-muted-foreground">Best offer</dt>
              <dd>
                <BestCell best={domain.best} />
              </dd>
              <dt className="text-muted-foreground">Last published</dt>
              <dd>
                <PublishedCell time={domain.publishedAt} now={now} />
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
