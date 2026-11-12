import { Button } from "@deparked/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@deparked/ui/table";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import {
  AnalyticsProblemAlert,
  formatCompactCount,
  formatConversion,
  VisitsSparkline,
} from "../../../components/analytics";
import { formatMoney } from "../../../components/format";
import { OfferMailBadge } from "../../../components/offer-mail";
import { PageError, PageHeader, PagePending } from "../../../components/page";
import { SetupChecklistCard } from "../../../components/setup-checklist";
import { StatusLabel } from "../../../components/status";
import { RelativeTime } from "../../../components/time";
import type { OverviewVisits } from "../../../server/analytics-shape";
import type { DomainOverview } from "../../../server/domains";
import { getAnalytics, getOverview } from "../../../server/domains.functions";

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

function Muted({ children }: { children: string }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function VisitsCell({ visits, host }: { visits: OverviewVisits; host: string }) {
  if (!visits.ok) return <Muted>Unavailable</Muted>;
  const own = visits.byHost[host];
  if (own === undefined) return <Muted>Not set up</Muted>;
  if (own.last30 === 0) return <Muted>No visits yet</Muted>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="tabular-nums">
        {formatCompactCount(own.last7)} / {formatCompactCount(own.last30)}
      </span>
      <VisitsSparkline daily={own.daily} />
    </span>
  );
}

function ConversionCell({ visits, domain }: { visits: OverviewVisits; domain: DomainOverview }) {
  const own = visits.ok ? visits.byHost[domain.host] : undefined;
  const conversion = own === undefined ? null : formatConversion(domain.recentOffers, own.last30);
  if (conversion === null) return <Muted>None</Muted>;
  return <span className="tabular-nums">{conversion}</span>;
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

function StatusCell({ domain }: { domain: DomainOverview }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusLabel status={domain.status} />
      {domain.status === "email_pending" ? <OfferMailBadge host={domain.host} mail={domain.mail} /> : null}
    </span>
  );
}

function PublishedCell({ time, now }: { time: number | null; now: number }) {
  if (time === null) return <span className="text-muted-foreground">Never</span>;
  return <RelativeTime time={time} now={now} />;
}

function OverviewPage() {
  const { domains, visits, checklist, now } = Route.useLoaderData();
  const card = checklist === null ? null : <SetupChecklistCard checklist={checklist} />;

  if (domains.length === 0) {
    return (
      <>
        {card}
        <div className="mx-auto mt-12 flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">No domains yet</h1>
          <p className="text-muted-foreground">
            Add a domain from your Cloudflare account to give it a for-sale page and an offer form.
          </p>
          <AddDomainButton />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="All domains"
        description={domains.length === 1 ? "1 domain" : `${domains.length} domains`}
        actions={<AddDomainButton />}
      />
      {card}
      {visits.ok ? null : <AnalyticsProblemAlert problem={visits.problem} />}
      <div className="hidden rounded-xl border lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Domain</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col">Visits, 7 / 30 days</TableHead>
              <TableHead scope="col">Offers</TableHead>
              <TableHead scope="col">Conversion, 30 days</TableHead>
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
                  <StatusCell domain={domain} />
                </TableCell>
                <TableCell>
                  <VisitsCell visits={visits} host={domain.host} />
                </TableCell>
                <TableCell>
                  <OffersCell domain={domain} />
                </TableCell>
                <TableCell>
                  <ConversionCell visits={visits} domain={domain} />
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
      <ul className="flex flex-col gap-3 lg:hidden">
        {domains.map((domain) => (
          <li key={domain.host} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Link to="/admin/d/$host" params={{ host: domain.host }} className={`min-w-0 ${HOST_LINK}`}>
                {domain.host}
              </Link>
              <StatusCell domain={domain} />
            </div>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Visits, 7 / 30 days</dt>
              <dd>
                <VisitsCell visits={visits} host={domain.host} />
              </dd>
              <dt className="text-muted-foreground">Offers</dt>
              <dd>
                <OffersCell domain={domain} />
              </dd>
              <dt className="text-muted-foreground">Conversion, 30 days</dt>
              <dd>
                <ConversionCell visits={visits} domain={domain} />
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
