import { BarChart } from "@deparked/ui/arc/bar-chart";
import { EmptyState } from "@deparked/ui/arc/empty-state";
import { MetricCard } from "@deparked/ui/arc/metric-card";
import { SegmentedControl } from "@deparked/ui/arc/segmented-control";
import { type DataColumn, SortableDataTable } from "@deparked/ui/arc/sortable-data-table";
import { Button } from "@deparked/ui/button";
import { Disclosure } from "@deparked/ui/flow";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChartNoAxesColumn, CloudOff, Hourglass } from "lucide-react";
import { useState } from "react";
import { AnalyticsProblemAlert, formatConversion, formatCount, OVER_100 } from "../../../components/analytics";
import { PageError, PagePending } from "../../../components/page";
import { DAYS, type DomainVisits, type NoSiteReason } from "../../../server/analytics-shape";
import { getDomainAnalytics } from "../../../server/domains.functions";

export const Route = createFileRoute("/admin/_shell/d/$host/analytics")({
  loader: async ({ params }) => {
    const analytics = await getDomainAnalytics({ data: { host: params.host } });
    if (analytics === null) throw notFound();
    return analytics;
  },
  head: ({ params }) => ({ meta: [{ title: `Visits · ${params.host} · Deparked` }] }),
  component: DomainAnalyticsPage,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

type Ok = Extract<DomainVisits, { state: "ok" }>;

const DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const LONG_DATE = new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const at = (date: string) => Date.parse(`${date}T00:00:00Z`);
const formatDate = (date: string) => DATE.format(at(date));

const SURFACE = "flex min-w-0 flex-col gap-5 rounded-[28px] bg-card p-5 shadow-lift sm:p-7";

/**
 * Offers per visit, exact to a tenth of a percent: the counter of Arc's metric card shows whole numbers only, so the
 * conversion rides on the offers card as its tag. More offers than counted visits reads ">100%" and says why.
 */
function conversion(offers: number, visits: number): { tag: string; context: string } | null {
  const exact = formatConversion(offers, visits);
  if (exact === null) return null;
  return {
    tag: `${exact} of visits`,
    context:
      exact === ">100%"
        ? OVER_100
        : `${formatCount(offers)} from ${formatCount(visits)} ${visits === 1 ? "visit" : "visits"}`,
  };
}

function Metrics({ visits, offers30 }: { visits: DomainVisits; offers30: number }) {
  const ok = visits.state === "ok" ? visits : null;
  const rate = ok === null ? null : conversion(offers30, ok.last30);
  return (
    <div className={ok === null ? "grid max-w-md grid-cols-1" : "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3"}>
      {ok === null ? null : (
        <>
          <MetricCard label={`Visits, ${DAYS} days`} value={ok.last30} context="Counted by Web Analytics" />
          <MetricCard label="Visits, 7 days" value={ok.last7} context="Today included" />
        </>
      )}
      {/* On a phone the two visit cards share a row and the offers card, with its conversion, takes the next. */}
      <div className="col-span-full grid lg:col-span-1">
        <MetricCard
          label={`Offers, ${DAYS} days`}
          value={offers30}
          context={rate?.context ?? "Every one is kept under Offers"}
          {...(rate === null ? {} : { change: rate.tag })}
        />
      </div>
    </div>
  );
}

type DayRow = { date: string; day: string; visits: number };

const DAY_COLUMNS: DataColumn<DayRow>[] = [
  { key: "day", label: "Day", sortable: true, render: (_, row) => formatDate(row.date) },
  { key: "visits", label: "Visits", sortable: true, numeric: true, render: (value) => formatCount(Number(value)) },
];

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: `${DAYS} days` },
];

function DailyVisits({ visits }: { visits: Ok }) {
  const [range, setRange] = useState<"7" | "30">("30");
  const days = range === "7" ? visits.days.slice(-7) : visits.days;
  const first = days[0];
  const last = days.at(-1);
  const period = first && last ? `${formatDate(first.date)} to ${formatDate(last.date)}, UTC` : "";
  // The table sorts by its "day" column: the ISO date sorts as the calendar does.
  const rows: DayRow[] = days.map((day) => ({ date: day.date, day: day.date, visits: day.visits }));
  return (
    <section aria-labelledby="visits-per-day" className={SURFACE}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="visits-per-day" className="font-heading text-xl font-bold tracking-[-0.01em]">
            Visits per day
          </h2>
          <p className="text-sm text-muted-foreground">Web Analytics can take a few minutes to count a new visit.</p>
        </div>
        <SegmentedControl
          label="Days shown"
          options={RANGES}
          value={range}
          onValueChange={(value) => setRange(value === "7" ? "7" : "30")}
        />
      </div>
      <BarChart
        label="Visits"
        period={period}
        averageLabel="Visits a day, on average"
        valueLabel="Visits"
        data={days.map((day, index) => ({
          key: day.date,
          label: LONG_DATE.format(at(day.date)),
          // A label every week keeps the axis quiet; the last day is always named.
          ...(range === "7" || (days.length - 1 - index) % 7 === 0 ? { axisLabel: formatDate(day.date) } : {}),
          value: day.visits,
        }))}
      />
      <Disclosure summary="Visits per day as a table">
        <div className="max-w-sm">
          <SortableDataTable
            rows={rows}
            columns={DAY_COLUMNS}
            rowKey="date"
            caption={`Visits per day, ${period}`}
            defaultSort={{ key: "day", direction: "desc" }}
          />
        </div>
      </Disclosure>
    </section>
  );
}

function TopList(props: { title: string; empty: string; rows: { label: string; visits: number }[] }) {
  const top = props.rows[0]?.visits ?? 0;
  return (
    <section aria-label={props.title} className={SURFACE}>
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-bold tracking-[-0.01em]">{props.title}</h2>
        <p className="text-sm text-muted-foreground">Last {DAYS} days, most visits first.</p>
      </div>
      {props.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.empty}</p>
      ) : (
        <ol className="flex flex-col gap-1.5 text-sm">
          {props.rows.map((row) => (
            <li key={row.label} className="relative overflow-hidden rounded-xl px-3 py-2">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 rounded-xl bg-tangerine/15"
                style={{ width: `${top === 0 ? 0 : (row.visits / top) * 100}%` }}
              />
              <span className="relative flex items-baseline justify-between gap-3">
                <span className="min-w-0 [overflow-wrap:anywhere]">{row.label}</span>
                <span className="shrink-0 font-semibold tabular-nums">{formatCount(row.visits)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const NOT_SET_UP: Record<NoSiteReason, { title: string; text: string }> = {
  missing: {
    title: "Visits are not counted yet",
    text: "This domain has no Cloudflare Web Analytics site. Setting the domain up again adds the missing site and changes nothing else. Offers are counted either way.",
  },
  adding: {
    title: "Visits are counted once the domain is added",
    text: "Adding this domain stopped before its Web Analytics site was made. Finish adding it to start counting visits. Offers are counted either way.",
  },
  off: {
    title: "Visits are not counted while the domain is off",
    text: "Turning the domain off removed its Web Analytics site. Turning it on again starts counting from that day.",
  },
};

function NotSetUp({ host, reason }: { host: string; reason: NoSiteReason }) {
  const copy = NOT_SET_UP[reason];
  return (
    <EmptyState
      icon={
        reason === "off" ? (
          <CloudOff width={24} height={24} strokeWidth={1.75} />
        ) : reason === "adding" ? (
          <Hourglass width={24} height={24} strokeWidth={1.75} />
        ) : (
          <ChartNoAxesColumn width={24} height={24} strokeWidth={1.75} />
        )
      }
      title={copy.title}
      description={copy.text}
      className="rounded-[28px] bg-card shadow-lift"
      // Adding or turning on is offered by the domain's own notice and Settings; only a missing site is fixed here.
      {...(reason === "missing"
        ? {
            action: (
              <Button asChild variant="accent">
                <Link to="/admin/add" search={{ host }}>
                  Set up visit counting
                </Link>
              </Button>
            ),
          }
        : {})}
    />
  );
}

function DomainAnalyticsPage() {
  const { visits, offers30 } = Route.useLoaderData();
  const { host } = Route.useParams();
  return (
    <div className="flex flex-col gap-5">
      {visits.state === "error" ? <AnalyticsProblemAlert problem={visits.problem} className="" /> : null}
      {visits.state === "not-set-up" ? <NotSetUp host={host} reason={visits.reason} /> : null}
      <Metrics visits={visits} offers30={offers30} />
      {visits.state === "ok" ? (
        visits.last30 === 0 ? (
          <EmptyState
            icon={<ChartNoAxesColumn width={24} height={24} strokeWidth={1.75} />}
            title={`No visits in the last ${DAYS} days`}
            description="They show here once people open the page."
            className="rounded-[28px] bg-card shadow-lift"
          />
        ) : (
          <>
            <DailyVisits visits={visits} />
            <div className="grid gap-5 lg:grid-cols-2">
              <TopList
                title="Referrers"
                empty="No referrers yet."
                rows={visits.referrers.map((row) => ({
                  label: row.host === "" ? "Direct" : row.host,
                  visits: row.visits,
                }))}
              />
              <TopList
                title="Countries"
                empty="No countries yet."
                rows={visits.countries.map((row) => ({ label: row.country, visits: row.visits }))}
              />
            </div>
          </>
        )
      ) : null}
    </div>
  );
}
