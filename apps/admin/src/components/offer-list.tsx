import type { OfferCursor, OfferSort, OfferStatus } from "@deparked/db";
import { Alert } from "@deparked/ui/arc/alert";
import { BottomSheet } from "@deparked/ui/arc/bottom-sheet";
import { ButtonGroup } from "@deparked/ui/arc/button-group";
import { CopyButton } from "@deparked/ui/arc/copy-button";
import { EmptyState } from "@deparked/ui/arc/empty-state";
import { ScrollArea } from "@deparked/ui/arc/scroll-area";
import { SegmentedControl } from "@deparked/ui/arc/segmented-control";
import { Select } from "@deparked/ui/arc/select";
import { Skeleton } from "@deparked/ui/arc/skeleton";
import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { cn } from "@deparked/ui/lib/utils";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Globe, Mail, TrendingUp } from "lucide-react";
import { Fragment, type ReactNode, useState, useSyncExternalStore } from "react";
import type { OfferItem } from "../server/offers";
import { getOffers, setOfferStatus } from "../server/offers.functions";
import { countryName, firstName, formatMoneyShort, relativeTime, replyHref } from "./format";
import { useHydrated } from "./hydrated";
import { offerContextLine, STATUS_ACTIONS, STATUS_FILTERS, STATUS_NOTE } from "./offer-copy";
import { PageThumbnail } from "./thumbnail";
import { RelativeTime } from "./time";

export type OfferFilter = { host?: string | undefined; status?: OfferStatus | undefined };
/** What a list shows: the filter, and its order (newest first when unset). */
export type OfferQuery = OfferFilter & { sort?: OfferSort | undefined };

/** What the Offers screens load: the first page, the offer a link points to when the page lacks it, counts. */
export type OffersData = {
  offers: OfferItem[];
  next: OfferCursor | null;
  selected: OfferItem | null;
  newCount: number;
  anyOffers: boolean;
  now: number;
};

export function exportHref(filter: OfferFilter): string {
  const search = new URLSearchParams();
  if (filter.host !== undefined) search.set("host", filter.host);
  if (filter.status !== undefined) search.set("status", filter.status);
  const query = search.toString();
  return `/admin/offers.csv${query === "" ? "" : `?${query}`}`;
}

// The labels stay for screen readers; the controls say what they hold.
const QUIET_LABEL = "[&_label]:sr-only";

/** Status (New with its count, Replied, Ignored, All), domain and order, each one a query parameter. */
export function OfferFilters(props: {
  query: OfferQuery;
  newCount: number;
  /** The domain filter's choices; left out on a domain's own Offers tab. */
  hosts?: readonly string[];
  /** The screen's path, for the plain links that stand in for the controls without JavaScript. */
  path: string;
  onChange: (query: OfferQuery) => void;
}) {
  const { query } = props;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
      <NoScriptFilters query={query} hosts={props.hosts} path={props.path} />
      <div data-needs-script="" className="contents">
        <SegmentedControl
          label="Show"
          value={query.status ?? "all"}
          options={STATUS_FILTERS.map((option) => ({
            value: option.value,
            label: option.label,
            accessory:
              option.value === "new" && props.newCount > 0 ? (
                <span className="rounded-full bg-tangerine px-1.5 text-xs font-semibold text-tangerine-foreground tabular-nums">
                  {props.newCount > 99 ? "99+" : props.newCount}
                </span>
              ) : undefined,
          }))}
          onValueChange={(value) => {
            const status = STATUS_FILTERS.find((option) => option.value === value)?.value;
            props.onChange({ ...query, status: status === "all" ? undefined : status });
          }}
        />
        {props.hosts === undefined ? null : (
          <div className={cn(QUIET_LABEL, "w-48 max-w-full min-w-0 max-sm:flex-[1_1_9rem]")}>
            <Select
              label="Domain"
              value={query.host ?? "all"}
              options={[
                { value: "all", label: "All domains" },
                ...props.hosts.map((host) => ({ value: host, label: host })),
              ]}
              onValueChange={(value) => props.onChange({ ...query, host: value === "all" ? undefined : value })}
            />
          </div>
        )}
        <div className={cn(QUIET_LABEL, "w-40 min-w-0 max-sm:flex-[1_1_8rem]")}>
          <Select
            label="Order"
            value={query.sort ?? "newest"}
            options={[
              { value: "newest", label: "Newest first" },
              { value: "highest", label: "Highest first" },
            ]}
            onValueChange={(value) => props.onChange({ ...query, sort: value === "highest" ? "highest" : undefined })}
          />
        </div>
      </div>
    </div>
  );
}

/** A filter as a URL on this screen: the same query parameters the controls write. */
export function filterHref(path: string, query: OfferQuery): string {
  const search = new URLSearchParams();
  if (query.status !== undefined) search.set("status", query.status);
  if (query.host !== undefined) search.set("host", query.host);
  if (query.sort !== undefined) search.set("sort", query.sort);
  const text = search.toString();
  return text === "" ? path : `${path}?${text}`;
}

const NOSCRIPT_LINK =
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium underline-offset-4 hover:underline aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground";

/**
 * Without JavaScript the controls cannot run (the shell holds them until it hydrates), so each choice is a plain
 * link. The domains sit in a disclosure, which needs no script either.
 */
function NoScriptFilters(props: { query: OfferQuery; hosts: readonly string[] | undefined; path: string }) {
  const { path } = props;
  // A domain's own tab has no domain choice, and its URL no `host`.
  const query = props.hosts === undefined ? { ...props.query, host: undefined } : props.query;
  const current = (match: boolean) => (match ? "page" : undefined);
  return (
    <noscript>
      <style>{"[data-needs-script]{display:none!important}"}</style>
      <nav aria-label="Filter offers" className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {STATUS_FILTERS.map((option) => {
          const status = option.value === "all" ? undefined : option.value;
          return (
            <a
              key={option.value}
              href={filterHref(path, { ...query, status })}
              aria-current={current(query.status === status)}
              className={NOSCRIPT_LINK}
            >
              {option.label}
            </a>
          );
        })}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
        {(["newest", "highest"] as const).map((sort) => (
          <a
            key={sort}
            href={filterHref(path, { ...query, sort: sort === "highest" ? "highest" : undefined })}
            aria-current={current((query.sort ?? "newest") === sort)}
            className={NOSCRIPT_LINK}
          >
            {sort === "highest" ? "Highest first" : "Newest first"}
          </a>
        ))}
        {props.hosts === undefined ? null : (
          <details className="w-full">
            <summary className="inline-flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
              Domain: {query.host ?? "All domains"}
            </summary>
            <span className="flex flex-wrap gap-1">
              {[undefined, ...props.hosts].map((host) => (
                <a
                  key={host ?? ""}
                  href={filterHref(path, { ...query, host })}
                  aria-current={current(query.host === host)}
                  className={cn(NOSCRIPT_LINK, "[overflow-wrap:anywhere]")}
                >
                  {host ?? "All domains"}
                </a>
              ))}
            </span>
          </details>
        )}
      </nav>
    </noscript>
  );
}

const subscribeWide = (onChange: () => void) => {
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const WIDE = "(min-width: 64rem)";

/** True from 1024 px up, where the list and the offer sit side by side. False on the server. */
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

function UnreadDot({ status }: { status: OfferStatus }) {
  if (status !== "new") return <span aria-hidden="true" className="size-2 shrink-0" />;
  return (
    <span className="size-2 shrink-0 rounded-full bg-tangerine">
      <span className="sr-only">, new</span>
    </span>
  );
}

function OfferRow(props: {
  offer: OfferItem;
  status: OfferStatus;
  now: number;
  showHost: boolean;
  /** `linked`: the URL picks it. `default`: shown beside the list because nothing is picked (wide screens only). */
  shown: "linked" | "default" | undefined;
  current: boolean;
}) {
  const { offer } = props;
  return (
    <li>
      <Link
        to="."
        search={(previous) => ({ ...previous, offer: offer.id })}
        resetScroll={false}
        aria-current={props.current ? "true" : undefined}
        data-shown={props.shown}
        className="flex min-h-16 items-center gap-3.5 rounded-[18px] px-3.5 py-3 outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[shown=linked]:bg-tangerine/12 lg:data-[shown=default]:bg-tangerine/12 max-sm:gap-3 max-sm:px-2.5 motion-reduce:transition-none"
      >
        <PageThumbnail
          host={offer.host}
          className="h-10 w-[52px] shrink-0 rounded-[9px] ring-1 ring-foreground/10 ring-inset [&>span]:hidden"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span dir="auto" className={cn("truncate", props.status === "new" ? "font-semibold" : "font-medium")}>
            {offer.name}
          </span>
          <span className="flex min-w-0 gap-1.5 text-[13.5px] text-muted-foreground">
            {props.showHost ? (
              <>
                <span translate="no" className="truncate">
                  {offer.host}
                </span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span className="shrink-0 whitespace-nowrap">{relativeTime(offer.createdAt, props.now)}</span>
          </span>
        </span>
        <span className="shrink-0 font-heading text-xl font-bold tracking-[-0.01em] tabular-nums max-sm:text-lg">
          {formatMoneyShort(offer.amountMinor, offer.currency)}
        </span>
        <UnreadDot status={props.status} />
      </Link>
    </li>
  );
}

/** The buyer's own words, as a speech bubble. A long message scrolls inside it. */
function Message({ text }: { text: string | null }) {
  if (text === null || text.trim() === "") {
    return <p className="text-muted-foreground">No message, just the offer.</p>;
  }
  return (
    <ScrollArea
      label="Message"
      maxHeight="16rem"
      className="rounded-[6px_20px_20px_20px] bg-background"
      viewportClassName="px-[18px] py-4"
    >
      <p dir="auto" className="text-[17px] leading-[1.45] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {text}
      </p>
    </ScrollArea>
  );
}

/** Mark-as links for a browser without JavaScript: each opens a page that asks once and saves with a plain form. */
function NoScriptActions(props: { offer: OfferItem; status: OfferStatus; back: string }) {
  return (
    <noscript>
      <style>{"[data-needs-script]{display:none!important}"}</style>
      <span className="flex flex-wrap gap-x-4 gap-y-2">
        {STATUS_ACTIONS[props.status].map((action) => (
          <a
            key={action.status}
            href={`/admin/offer-status?${new URLSearchParams({ id: props.offer.id, status: action.status, back: props.back })}`}
            className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
          >
            {action.label}
          </a>
        ))}
      </span>
    </noscript>
  );
}

/**
 * The amount, the loudest thing on the screen. Long amounts step down a size, and only break after a group
 * separator, never inside one.
 */
function Amount({ text }: { text: string }) {
  const size =
    text.length <= 9
      ? "text-[clamp(2.75rem,2rem+2.5vw,4rem)]"
      : text.length <= 13
        ? "text-[clamp(2.25rem,1.6rem+2vw,3rem)]"
        : "text-[clamp(1.75rem,1.3rem+1.5vw,2.25rem)]";
  const groups = text.split(/(?<=,)/);
  return (
    <span className={cn("font-heading leading-none font-bold tracking-[-0.03em] tabular-nums", size)}>
      {groups.map((group, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the groups of one number, in order
        <Fragment key={index}>
          {index === 0 ? null : <wbr />}
          {group}
        </Fragment>
      ))}
    </span>
  );
}

/** One offer in full: the amount first, who and for which domain, their words, how to reach them, what to do. */
function OfferDetail(props: {
  offer: OfferItem;
  status: OfferStatus;
  now: number;
  busy: boolean;
  error: string | undefined;
  back: string;
  onStatus: (status: OfferStatus) => void;
}) {
  const { offer, status } = props;
  const country = countryName(offer.country);
  const context = offerContextLine(offer);
  const note = STATUS_NOTE[status];
  return (
    <article aria-label={`Offer from ${offer.name}`} className="flex min-w-0 flex-col gap-[22px]">
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-4">
        <PageThumbnail
          host={offer.host}
          className="h-[92px] w-[132px] shrink-0 rounded-[14px] ring-1 ring-foreground/10 ring-inset max-sm:h-[69px] max-sm:w-[99px]"
        />
        <h2 className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <span dir="auto" className="text-[13.5px] font-normal text-muted-foreground [overflow-wrap:anywhere]">
            {offer.name} offers
          </span>
          <Amount text={formatMoneyShort(offer.amountMinor, offer.currency)} />
          <span className="text-[13.5px] font-normal text-muted-foreground [overflow-wrap:anywhere]">
            for <span translate="no">{offer.host}</span> · <RelativeTime time={offer.createdAt} now={props.now} />
          </span>
        </h2>
        {note === null ? null : <Badge variant="secondary">{note}</Badge>}
      </div>

      <Message text={offer.message} />

      <dl className="flex flex-wrap gap-x-[26px] gap-y-2.5 text-sm text-muted-foreground">
        <div className="flex max-w-full min-w-0 items-center gap-2">
          <dt>
            <Mail aria-hidden="true" className="size-4" />
            <span className="sr-only">Email</span>
          </dt>
          <dd className="flex min-w-0 items-center gap-1 text-foreground">
            <span translate="no" className="min-w-0 [overflow-wrap:anywhere]">
              {offer.email}
            </span>
            <CopyButton value={offer.email} label="Copy the buyer's email" iconOnly variant="plain" />
          </dd>
        </div>
        {country === null ? null : (
          <div className="flex items-center gap-2">
            <dt>
              <Globe aria-hidden="true" className="size-4" />
              <span className="sr-only">Country</span>
            </dt>
            <dd>{country}</dd>
          </div>
        )}
        {context === null ? null : (
          <div className="flex items-center gap-2">
            <dt>
              <TrendingUp aria-hidden="true" className="size-4" />
              <span className="sr-only">On this domain</span>
            </dt>
            <dd>{context}</dd>
          </div>
        )}
      </dl>

      {offer.emailStatus === "failed" ? (
        <Alert tone="warning" title="The notification email was not sent">
          <span className="[overflow-wrap:anywhere]">
            This offer is only here in Offers.{offer.emailError ? ` Error: ${offer.emailError}` : ""}
          </span>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 border-t pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button asChild variant={status === "new" ? "accent" : "outline"} size="lg" className="max-w-full">
            <a href={replyHref(offer.email, offer.host)}>
              <span className="truncate">Reply to {firstName(offer.name)}</span>
            </a>
          </Button>
          <div data-needs-script="">
            <ButtonGroup
              label="Mark this offer"
              disabled={props.busy}
              items={STATUS_ACTIONS[status].map((action) => ({
                id: action.status,
                label: action.label,
                onSelect: () => props.onStatus(action.status),
              }))}
            />
          </div>
          <NoScriptActions offer={offer} status={status} back={props.back} />
        </div>
        {props.error ? (
          <p role="alert" className="text-sm text-destructive">
            {props.error}
          </p>
        ) : null}
      </div>
    </article>
  );
}

const PANE = "min-w-0 rounded-[28px] bg-card p-7 shadow-lift max-sm:p-5";

/**
 * The Offers screen under its filters: a compact list and, from 1024 px up, the selected offer beside it. On
 * smaller screens the offer opens in a bottom sheet. The selection is `?offer=` in the URL, so reload and back
 * keep it; without it the newest (or highest) offer shows. Before and without JavaScript the selected offer is
 * part of the page, so every offer can be read and answered. Mount it with a `key` made of the query, so a new
 * filter or order starts from the loader's first page again.
 */
export function OffersView(props: {
  data: OffersData;
  query: OfferQuery;
  selectedId: string | undefined;
  showHost: boolean;
  /** Where the page is, for the no-JavaScript status forms to come back to. */
  back: string;
  empty: ReactNode;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const hydrated = useHydrated();
  const wide = useWide();
  const loadPage = useServerFn(getOffers);
  const changeStatus = useServerFn(setOfferStatus);
  const [offers, setOffers] = useState(props.data.offers);
  const [next, setNext] = useState(props.data.next);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Status changes show at once and stay until the next load says the same.
  const [statuses, setStatuses] = useState<Readonly<Record<string, OfferStatus>>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const statusOf = (offer: OfferItem) => statuses[offer.id] ?? offer.status;
  const linked =
    props.selectedId === undefined
      ? undefined
      : (offers.find((offer) => offer.id === props.selectedId) ??
        (props.data.selected?.id === props.selectedId ? props.data.selected : undefined));
  const shown = linked ?? offers[0];
  const sheetOpen = hydrated && !wide && linked !== undefined;
  // The sheet keeps showing its offer while it slides away.
  const [sheetOffer, setSheetOffer] = useState(linked);
  if (linked !== undefined && linked !== sheetOffer) setSheetOffer(linked);

  async function onStatus(offer: OfferItem, status: OfferStatus) {
    const previous = statusOf(offer);
    setBusy((current) => new Set(current).add(offer.id));
    setErrors(({ [offer.id]: _, ...rest }) => rest);
    setStatuses((current) => ({ ...current, [offer.id]: status }));
    try {
      const result = await changeStatus({ data: { id: offer.id, status } });
      if (!result.ok) throw new Error("gone");
      // The navigation's badge and the New count follow.
      await router.invalidate();
    } catch {
      setStatuses((current) => ({ ...current, [offer.id]: previous }));
      setErrors((current) => ({ ...current, [offer.id]: "That did not save. Check the connection and try again." }));
    } finally {
      setBusy((current) => {
        const rest = new Set(current);
        rest.delete(offer.id);
        return rest;
      });
    }
  }

  async function loadMore() {
    if (next === null || loading) return;
    setLoading(true);
    setLoadError(false);
    try {
      const page = await loadPage({ data: { ...props.query, before: next } });
      setOffers((current) => [...current, ...page.offers]);
      setNext(page.next);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  if (offers.length === 0 && linked === undefined) return <>{props.empty}</>;

  const detailOf = (offer: OfferItem) => (
    <OfferDetail
      key={offer.id}
      offer={offer}
      status={statusOf(offer)}
      now={props.data.now}
      busy={busy.has(offer.id)}
      error={errors[offer.id]}
      back={props.back}
      onStatus={(status) => void onStatus(offer, status)}
    />
  );

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section aria-label="List of offers" className="flex min-w-0 flex-col rounded-3xl bg-card p-2 shadow-lift">
        <ul className="flex flex-col gap-0.5">
          {offers.map((offer) => (
            <OfferRow
              key={offer.id}
              offer={offer}
              status={statusOf(offer)}
              now={props.data.now}
              showHost={props.showHost}
              shown={offer.id !== shown?.id ? undefined : linked === undefined ? "default" : "linked"}
              current={offer.id === shown?.id && (linked !== undefined || wide)}
            />
          ))}
        </ul>
        <div className="flex flex-col items-center gap-1 px-3 pt-2 pb-1 text-center" aria-live="polite">
          {next !== null ? (
            <Button variant="ghost" aria-disabled={loading} onClick={() => void loadMore()}>
              {loading ? "Loading…" : "Load more"}
            </Button>
          ) : offers.length > 1 ? (
            <p className="py-2 text-[13.5px] text-muted-foreground">That is all {offers.length} offers.</p>
          ) : null}
          {loadError ? <p className="text-sm text-destructive">More offers could not be loaded. Try again.</p> : null}
          <a
            href={exportHref(props.query)}
            download
            className="inline-flex min-h-11 items-center rounded-sm px-2 text-[13.5px] text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Download as a spreadsheet
          </a>
        </div>
      </section>

      {shown === undefined ? null : (
        <section
          aria-label="Selected offer"
          className={cn(
            PANE,
            "lg:sticky lg:top-6",
            // Phones get the sheet once the page runs; before that (or without JavaScript) a linked offer sits on
            // top of the list.
            "max-lg:order-first max-lg:hidden",
          )}
          data-inline-offer={linked === undefined ? undefined : ""}
        >
          {/* Phones open the offer in a sheet; without JavaScript there is none, so it shows above the list. */}
          <noscript>
            <style>{"@media (max-width:63.999rem){[data-inline-offer]{display:block!important}}"}</style>
          </noscript>
          {detailOf(shown)}
        </section>
      )}

      {hydrated && !wide ? (
        <BottomSheet
          open={sheetOpen}
          onOpenChange={(open) => {
            if (!open)
              void navigate({ to: ".", search: (previous) => ({ ...previous, offer: undefined }), replace: true });
          }}
          title={sheetOffer === undefined ? "Offer" : `Offer from ${firstName(sheetOffer.name)}`}
          detents={[0.92]}
          closeLabel="Close the offer"
        >
          {sheetOffer === undefined ? null : detailOf(sheetOffer)}
        </BottomSheet>
      ) : null}
    </div>
  );
}

/** Nothing to show: no offer yet at all, or none under this filter. Each says what brings one, or how to widen it. */
export function NoOffers(props: { title: string; description: string; action?: ReactNode; icon: ReactNode }) {
  return (
    <EmptyState
      title={props.title}
      description={props.description}
      icon={props.icon}
      action={props.action}
      className="rounded-[28px] bg-card py-14 shadow-lift"
    />
  );
}

/** While a filter loads: the list's rows and the offer beside it, as placeholders in their own places. */
export function OffersPending() {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="flex flex-col gap-5 rounded-3xl bg-card p-5 shadow-lift">
        {Array.from({ length: 5 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders without identity
          <Skeleton key={index} label="Loading offers" avatar lines={2} />
        ))}
      </div>
      <div className={cn(PANE, "max-lg:hidden")}>
        <Skeleton label="Loading the offer" avatar lines={5} />
      </div>
    </div>
  );
}
