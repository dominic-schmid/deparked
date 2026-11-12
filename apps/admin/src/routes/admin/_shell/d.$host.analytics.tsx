import { Button } from "@deparked/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { SparkChart } from "@deparked/ui/ruixen/spark-chart";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AnalyticsProblemAlert, ConversionValue, formatConversion, formatCount } from "../../../components/analytics";
import { PageError, PagePending } from "../../../components/page";
import { DAYS, type DomainVisits, type NoSiteReason } from "../../../server/analytics-shape";
import { getDomainAnalytics } from "../../../server/domains.functions";

export const Route = createFileRoute("/admin/_shell/d/$host/analytics")({
  loader: async ({ params }) => {
    const analytics = await getDomainAnalytics({ data: { host: params.host } });
    if (analytics === null) throw notFound();
    return analytics;
  },
  head: ({ params }) => ({ meta: [{ title: `Analytics · ${params.host} · Deparked` }] }),
  component: DomainAnalyticsPage,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

type Ok = Extract<DomainVisits, { state: "ok" }>;

const DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const formatDate = (date: string) => DATE.format(Date.parse(`${date}T00:00:00Z`));

/** `null`: not known right now (no visits to count or divide by). */
function Stat({ label, value }: { label: string; value: ReactNode | null }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">
        {value ?? (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              –
            </span>
            <span className="sr-only">Not available</span>
          </>
        )}
      </dd>
    </div>
  );
}

function Stats({ visits, offers30 }: { visits: DomainVisits; offers30: number }) {
  const ok = visits.state === "ok" ? visits : null;
  const conversion = ok === null ? null : formatConversion(offers30, ok.last30);
  return (
    <dl className="mb-6 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-4">
      <Stat label="Visits, 7 days" value={ok === null ? null : formatCount(ok.last7)} />
      <Stat label={`Visits, ${DAYS} days`} value={ok === null ? null : formatCount(ok.last30)} />
      <Stat label={`Offers, ${DAYS} days`} value={formatCount(offers30)} />
      <Stat
        label={`Conversion, ${DAYS} days`}
        value={conversion === null ? null : <ConversionValue value={conversion} />}
      />
    </dl>
  );
}

function DailyVisits({ visits }: { visits: Ok }) {
  const first = visits.days[0];
  const last = visits.days.at(-1);
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>
          <h2>Visits per day</h2>
        </CardTitle>
        <CardDescription>
          {first && last ? `${formatDate(first.date)} to ${formatDate(last.date)}, UTC.` : null} Web Analytics can take
          a few minutes to count a new visit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {visits.last30 === 0 ? (
          <p className="text-sm text-muted-foreground">
            No visits in the last {DAYS} days. They show here once people open the page.
          </p>
        ) : (
          <>
            <div aria-hidden="true" className="text-primary">
              <SparkChart
                data={visits.days.map((day) => day.visits)}
                height={160}
                color="currentColor"
                formatValue={(value) => formatCount(Math.round(value))}
              />
            </div>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer rounded-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                Visits per day as a table
              </summary>
              <table className="mt-2 w-full max-w-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-1 font-medium">
                      Day
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Visits
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visits.days.map((day) => (
                    <tr key={day.date} className="border-b last:border-0">
                      <th scope="row" className="py-1 text-left font-normal">
                        {formatDate(day.date)}
                      </th>
                      <td className="py-1 text-right tabular-nums">{formatCount(day.visits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TopList(props: { title: string; empty: string; rows: { label: string; visits: number }[] }) {
  const top = props.rows[0]?.visits ?? 0;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2>{props.title}</h2>
        </CardTitle>
        <CardDescription>Last {DAYS} days, most visits first.</CardDescription>
      </CardHeader>
      <CardContent>
        {props.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{props.empty}</p>
        ) : (
          <ol className="flex flex-col gap-2 text-sm">
            {props.rows.map((row) => (
              <li key={row.label} className="relative overflow-hidden rounded-md px-2 py-1.5">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 rounded-md bg-secondary"
                  style={{ width: `${top === 0 ? 0 : (row.visits / top) * 100}%` }}
                />
                <span className="relative flex items-baseline justify-between gap-3">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{row.label}</span>
                  <span className="shrink-0 tabular-nums">{formatCount(row.visits)}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
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
    <Card className="mb-6 max-w-xl">
      <CardHeader>
        <CardTitle>
          <h2>{copy.title}</h2>
        </CardTitle>
        <CardDescription>{copy.text}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link to="/admin/add" search={{ host }}>
            {reason === "missing" ? "Set up visit counting" : reason === "adding" ? "Continue adding" : "Turn on…"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function DomainAnalyticsPage() {
  const { visits, offers30 } = Route.useLoaderData();
  const { host } = Route.useParams();
  return (
    <>
      {visits.state === "error" ? <AnalyticsProblemAlert problem={visits.problem} /> : null}
      {visits.state === "not-set-up" ? <NotSetUp host={host} reason={visits.reason} /> : null}
      <Stats visits={visits} offers30={offers30} />
      {visits.state === "ok" ? (
        <>
          <DailyVisits visits={visits} />
          <div className="grid gap-6 lg:grid-cols-2">
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
      ) : null}
    </>
  );
}
