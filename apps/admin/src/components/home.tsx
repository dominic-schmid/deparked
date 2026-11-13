import { Card } from "@deparked/ui/arc/card";
import { HoverCard } from "@deparked/ui/arc/hover-card";
import { type DataColumn, SortableDataTable } from "@deparked/ui/arc/sortable-data-table";
import { Sparkline } from "@deparked/ui/arc/sparkline";
import { ToggleGroup, ToggleGroupItem } from "@deparked/ui/arc/toggle-group";
import { Button } from "@deparked/ui/button";
import { cn } from "@deparked/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { LayoutGrid, List, Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  type NoSiteReason,
  type OverviewVisits,
  type VisitsCellState,
  visitsCellState,
} from "../server/analytics-shape";
import type { DomainOverview } from "../server/domains";
import { ConversionValue, formatCompactCount, formatConversion, formatCount, VisitsSparkline } from "./analytics";
import { formatMoneyShort, relativeTime, replyHref } from "./format";
import { greeting, HOME_VIEW_COOKIE, type HomeView } from "./home-copy";
import { OfferMailBadge } from "./offer-mail";
import { StatusDot, statusLabel } from "./status";
import { PageThumbnail } from "./thumbnail";
import { RelativeTime } from "./time";

const TEXT_LINK =
  "rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** "Friday morning" in the owner's own time zone: the server cannot know it, so the line fills in once React runs. */
export function Greeting() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(greeting(new Date())), []);
  return <p className="min-h-5 text-sm font-medium text-muted-foreground">{text}</p>;
}

export type BestOffer = {
  host: string;
  name: string;
  email: string;
  country: string | null;
  amountMinor: number;
  currency: string;
  createdAt: number;
};

function countryName(code: string | null): string | null {
  if (code === null) return null;
  try {
    return new Intl.DisplayNames("en", { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The first word of the buyer's name, for the button; long names end in an ellipsis there. */
function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.length > 18 ? `${first.slice(0, 17)}…` : first;
}

/** The highest offer nobody has answered yet: money first, then who, then one button to answer. */
export function BestOfferCard({ offer, now, waiting }: { offer: BestOffer; now: number; waiting: number }) {
  const where = countryName(offer.country);
  return (
    <section
      aria-labelledby="best-offer"
      className="flex min-w-0 flex-col gap-4 rounded-[28px] bg-[#14162b] p-6 text-white shadow-lift sm:p-7 dark:bg-card dark:ring-1 dark:ring-border"
    >
      <div className="flex items-center justify-between gap-3 text-[13px] text-[#c9cee6]">
        <h2 id="best-offer" className="font-sans font-medium">
          Best new offer
        </h2>
        <span className="tabular-nums">{relativeTime(offer.createdAt, now)}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-heading text-[clamp(2.5rem,1.8rem+2.4vw,3.5rem)] leading-none font-bold tracking-[-0.02em] tabular-nums [overflow-wrap:anywhere]">
          {formatMoneyShort(offer.amountMinor, offer.currency)}
        </p>
        <p className="min-w-0 text-[#c9cee6] [overflow-wrap:anywhere]">
          for{" "}
          <span translate="no" className="text-white">
            {offer.host}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[#c9cee6] [overflow-wrap:anywhere]">
          {offer.name}
          {where === null ? null : ` · ${where}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {waiting > 1 ? (
            <Link
              to="/admin/inbox"
              className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-[#c9cee6] outline-none hover:text-white focus-visible:ring-[3px] focus-visible:ring-ring/60"
            >
              All {formatCount(waiting)} new
            </Link>
          ) : null}
          <Button asChild variant="accent" size="lg" className="max-w-full">
            <a href={replyHref(offer.email, offer.host)}>
              <span className="truncate">Reply to {firstName(offer.name)}</span>
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

/** With nothing waiting: how many people looked at the pages over the last 30 days, all domains together. */
export function VisitsCard({ visits }: { visits: OverviewVisits }) {
  if (!visits.ok) return null;
  const hosts = Object.values(visits.byHost);
  const daily = hosts.reduce<number[]>((sum, host) => host.daily.map((value, index) => value + (sum[index] ?? 0)), []);
  const total = hosts.reduce((sum, host) => sum + host.last30, 0);
  if (total === 0) return null;
  return (
    <section aria-label="Visits" className="min-w-0 rounded-[28px] bg-card p-6 shadow-lift sm:p-7">
      <Sparkline
        data={daily}
        label="Visits, last 30 days"
        value={formatCount(total)}
        tone="accent"
        area
        width={480}
        height={120}
      />
    </section>
  );
}

const NOT_COUNTED: Record<Exclude<NoSiteReason, "missing">, string> = {
  off: "Not counted while off",
  adding: "Counted once it is added",
};

/** The window's visits line: a count, or what to do instead of an empty value. */
function CardVisits({ state, host }: { state: VisitsCellState; host: string }) {
  switch (state.kind) {
    case "ok":
      return (
        <span className="tabular-nums">
          {formatCompactCount(state.visits.last30)} {state.visits.last30 === 1 ? "visit" : "visits"} in 30 days
        </span>
      );
    case "no-visits":
      return <span>No visits yet</span>;
    case "unavailable":
      return <span>Visits unavailable</span>;
    case "not-set-up":
      if (state.reason !== "missing") return <span>{NOT_COUNTED[state.reason]}</span>;
      return (
        <Link to="/admin/add" search={{ host }} className={cn(TEXT_LINK, "relative z-[2]")}>
          Set up visits
        </Link>
      );
  }
}

/** What the domain is doing, or for a domain that is not live the next step as a link. */
function NextStep({ domain }: { domain: DomainOverview }) {
  const link = cn(TEXT_LINK, "relative z-[2] inline-flex min-h-6 items-center gap-2");
  const params = { host: domain.host };
  switch (domain.status) {
    case "live":
      return (
        <span className="inline-flex items-center gap-2">
          <StatusDot status="live" />
          Live
        </span>
      );
    case "email_pending":
      return (
        <span className="relative z-[2] inline-flex items-center gap-2">
          <OfferMailBadge host={domain.host} mail={domain.mail} />
        </span>
      );
    case "draft":
      return (
        <Link to="/admin/d/$host" params={params} className={link}>
          <StatusDot status="draft" />
          Finish its page
        </Link>
      );
    case "off":
      return (
        <Link to="/admin/d/$host/settings" params={params} className={link}>
          <StatusDot status="off" />
          Turn it back on
        </Link>
      );
    case "error":
      return (
        <Link to="/admin/d/$host" params={params} className={link}>
          <StatusDot status="error" />
          Fix its setup
        </Link>
      );
  }
}

function offersLabel(domain: DomainOverview): string {
  const count = `${formatCount(domain.offers)} ${domain.offers === 1 ? "offer" : "offers"}`;
  return domain.best === null ? count : `${count} · ${formatMoneyShort(domain.best.amountMinor, domain.best.currency)}`;
}

/** The price tag hung on a window: how many offers and the best one. Tangerine while some are new. */
function PriceTag({ domain }: { domain: DomainOverview }) {
  if (domain.offers === 0) return null;
  return (
    <Link
      to="/admin/d/$host/offers"
      params={{ host: domain.host }}
      className={cn(
        "absolute right-3 bottom-3 z-[2] max-w-[calc(100%-1.5rem)] -rotate-[4deg] truncate rounded-[10px] px-3 py-1.5 text-[13px] font-semibold tabular-nums shadow-[0_4px_10px_rgb(20_22_43/0.18)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60",
        domain.newOffers > 0 ? "bg-tangerine text-tangerine-foreground" : "bg-card text-foreground",
      )}
    >
      {offersLabel(domain)}
      {domain.newOffers > 0 ? <span className="sr-only">, {formatCount(domain.newOffers)} new</span> : null}
    </Link>
  );
}

/** One domain as its shop window: the live page, its state or next step, its visits and its price tag. */
export function WindowCard({ domain, visits }: { domain: DomainOverview; visits: OverviewVisits }) {
  return (
    <Card
      title={domain.host}
      translate="no"
      className="border-transparent shadow-lift [&_h3]:font-semibold [&_h3]:[overflow-wrap:anywhere] [&_h3]:[text-wrap:wrap]"
      media={
        <div className="relative w-full">
          <PageThumbnail host={domain.host} />
          <PriceTag domain={domain} />
        </div>
      }
    >
      <Link
        to="/admin/d/$host"
        params={{ host: domain.host }}
        className="absolute inset-0 z-[1] rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-inset"
      >
        <span className="sr-only">Open {domain.host}</span>
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <NextStep domain={domain} />
        <CardVisits state={visitsCellState(domain, visits)} host={domain.host} />
      </div>
    </Card>
  );
}

/** The last window: put another domain up. */
export function AddDomainCard() {
  return (
    <Link
      to="/admin/add"
      className="flex min-h-60 flex-col items-center justify-center gap-3 rounded-[var(--radius-panel)] border-2 border-dashed border-input p-6 font-semibold text-muted-foreground outline-none transition-colors duration-150 hover:border-muted-foreground/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
    >
      <span className="grid size-12 place-items-center rounded-full bg-card text-foreground shadow-rest">
        <Plus className="size-5" aria-hidden="true" />
      </span>
      Add a domain
    </Link>
  );
}

const STATUS_ORDER = { error: 0, draft: 1, off: 2, email_pending: 3, live: 4 } as const;

function VisitsCell({ state, host }: { state: VisitsCellState; host: string }) {
  switch (state.kind) {
    case "unavailable":
      return <span className="text-muted-foreground">Unavailable</span>;
    case "no-visits":
      return <span className="text-muted-foreground">No visits yet</span>;
    case "not-set-up":
      if (state.reason !== "missing") return <span className="text-muted-foreground">{NOT_COUNTED[state.reason]}</span>;
      return (
        <span className="text-muted-foreground">
          Not set up.{" "}
          <Link to="/admin/add" search={{ host }} className={TEXT_LINK}>
            Set it up
          </Link>
        </span>
      );
    case "ok":
      return (
        <span className="inline-flex items-center justify-end gap-3">
          <VisitsSparkline daily={state.visits.daily} />
          <span className="whitespace-nowrap tabular-nums">
            {formatCompactCount(state.visits.last7)} / {formatCompactCount(state.visits.last30)}
          </span>
        </span>
      );
  }
}

type Row = {
  host: string;
  status: number;
  visits: number | null;
  offers: number;
  best: number | null;
  conversion: number | null;
  published: number | null;
  domain: DomainOverview;
  state: VisitsCellState;
};

/** The compact view for a large portfolio: one sortable row per domain, its page a hover away. */
export function DomainTable({
  domains,
  visits,
  now,
}: {
  domains: DomainOverview[];
  visits: OverviewVisits;
  now: number;
}) {
  const rows: Row[] = domains.map((domain) => {
    const state = visitsCellState(domain, visits);
    const last30 = state.kind === "ok" ? state.visits.last30 : state.kind === "no-visits" ? 0 : null;
    return {
      host: domain.host,
      status: STATUS_ORDER[domain.status],
      visits: last30,
      offers: domain.offers,
      // Amounts in different currencies are not converted; the sort compares the plain numbers.
      best: domain.best?.amountMinor ?? null,
      conversion: last30 ? domain.recentOffers / last30 : null,
      published: domain.publishedAt,
      domain,
      state,
    };
  });
  const columns: DataColumn<Row>[] = [
    {
      key: "host",
      label: "Domain",
      render: (_, row) => (
        <HoverCard content={<PageThumbnail host={row.host} className="w-80 max-w-[70vw] rounded-lg" />} side="right">
          <Link
            to="/admin/d/$host"
            params={{ host: row.host }}
            translate="no"
            className="rounded-sm font-medium underline-offset-4 outline-none [overflow-wrap:anywhere] hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {row.host}
          </Link>
        </HoverCard>
      ),
    },
    {
      key: "status",
      label: "Status",
      numeric: false,
      render: (_, row) => (
        <span className="inline-flex flex-col items-start gap-1">
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <StatusDot status={row.domain.status} />
            {statusLabel(row.domain.status)}
          </span>
          {row.domain.status === "email_pending" ? <OfferMailBadge host={row.host} mail={row.domain.mail} /> : null}
        </span>
      ),
    },
    {
      key: "visits",
      label: "Visits, 7 / 30 days",
      numeric: true,
      render: (_, row) => <VisitsCell state={row.state} host={row.host} />,
    },
    {
      key: "offers",
      label: "Offers",
      numeric: true,
      render: (_, row) =>
        row.offers === 0 ? (
          <span className="text-muted-foreground">0</span>
        ) : (
          <Link
            to="/admin/d/$host/offers"
            params={{ host: row.host }}
            className="rounded-sm tabular-nums underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {formatCount(row.offers)}
            {row.domain.newOffers > 0 ? ` (${formatCount(row.domain.newOffers)} new)` : ""}
          </Link>
        ),
    },
    {
      key: "best",
      label: "Best offer",
      numeric: true,
      render: (_, row) =>
        row.domain.best === null ? (
          <span className="text-muted-foreground">–</span>
        ) : (
          <span className="font-heading font-bold tabular-nums">
            {formatMoneyShort(row.domain.best.amountMinor, row.domain.best.currency)}
          </span>
        ),
    },
    {
      key: "conversion",
      label: "Conversion",
      numeric: true,
      render: (_, row) => {
        const value =
          row.state.kind === "ok" ? formatConversion(row.domain.recentOffers, row.state.visits.last30) : null;
        return value === null ? <span className="text-muted-foreground">–</span> : <ConversionValue value={value} />;
      },
    },
    {
      key: "published",
      label: "Published",
      numeric: false,
      render: (_, row) =>
        row.published === null ? (
          <span className="text-muted-foreground">Not yet</span>
        ) : (
          <RelativeTime time={row.published} now={now} />
        ),
    },
  ];
  return (
    <SortableDataTable
      rows={rows}
      columns={columns}
      rowKey="host"
      caption="All domains"
      itemName={{ one: "domain", other: "domains" }}
    />
  );
}

/** Windows or the list, remembered for this browser in a cookie so the next visit renders it straight away. */
export function ViewSwitch({ view, onChange }: { view: HomeView; onChange: (view: HomeView) => void }) {
  return (
    <ToggleGroup
      label="Show domains as"
      value={view}
      onValueChange={(value) => {
        const next: HomeView = value === "list" ? "list" : "grid";
        const secure = window.location.protocol === "https:" ? "; Secure" : "";
        // biome-ignore lint/suspicious/noDocumentCookie: a plain preference the server reads to render the view
        document.cookie = `${HOME_VIEW_COOKIE}=${next}; Path=/admin; Max-Age=31536000; SameSite=Lax${secure}`;
        onChange(next);
      }}
      className="bg-card shadow-rest pointer-coarse:[--tg-h:44px]"
    >
      <ToggleGroupItem value="grid" label="Windows">
        <LayoutGrid aria-hidden="true" />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" label="List">
        <List aria-hidden="true" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("flex flex-col gap-5", className)}>{children}</section>;
}
