import type { Offer, OfferCursor, OfferStatus } from "@deparked/db";
import { Alert, AlertDescription, AlertTitle } from "@deparked/ui/alert";
import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Mail, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { getOffers, setOfferStatus } from "../server/offers.functions";
import { formatMoney, replyHref } from "./format";
import { RelativeTime } from "./time";

export type OfferFilter = { host?: string | undefined; status?: OfferStatus | undefined };

const STATUS_LABEL: Record<OfferStatus, string> = { new: "New", replied: "Replied", ignored: "Ignored" };
export const STATUS_FILTERS: readonly { status: OfferStatus | undefined; label: string }[] = [
  { status: undefined, label: "All" },
  { status: "new", label: "New" },
  { status: "replied", label: "Replied" },
  { status: "ignored", label: "Ignored" },
];

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames("en", { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function exportHref(filter: OfferFilter): string {
  const search = new URLSearchParams();
  if (filter.host !== undefined) search.set("host", filter.host);
  if (filter.status !== undefined) search.set("status", filter.status);
  const query = search.toString();
  return `/admin/offers.csv${query === "" ? "" : `?${query}`}`;
}

export function ExportButton({ filter }: { filter: OfferFilter }) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={exportHref(filter)} download>
        <Download aria-hidden="true" />
        Export CSV
      </a>
    </Button>
  );
}

const LONG_MESSAGE = 280;

function Message({ text }: { text: string }) {
  const body = (
    <p dir="auto" className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
      {text}
    </p>
  );
  if (text.length <= LONG_MESSAGE) return body;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none rounded-sm text-sm [&::-webkit-details-marker]:hidden outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span dir="auto" className="line-clamp-2 [overflow-wrap:anywhere] group-open:hidden">
          {text}
        </span>
        <span className="font-medium underline underline-offset-4 group-open:hidden">Show the whole message</span>
        <span className="hidden font-medium underline underline-offset-4 group-open:inline">Hide the message</span>
      </summary>
      <div className="mt-2">{body}</div>
    </details>
  );
}

function OfferCard(props: {
  offer: Offer;
  now: number;
  showHost: boolean;
  busy: boolean;
  error: string | undefined;
  onStatus: (status: OfferStatus) => void;
}) {
  const { offer } = props;
  const others = (["new", "replied", "ignored"] as const).filter((status) => status !== offer.status);
  const actionLabel: Record<OfferStatus, string> = {
    new: "Mark as new",
    replied: "Mark as replied",
    ignored: "Ignore",
  };
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">
          {formatMoney(offer.amountMinor, offer.currency)}
        </p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={offer.status === "new" ? "default" : "secondary"}>{STATUS_LABEL[offer.status]}</Badge>
          <RelativeTime time={offer.createdAt} now={props.now} />
        </p>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {props.showHost ? (
          <>
            <dt className="text-muted-foreground">Domain</dt>
            <dd className="[overflow-wrap:anywhere]">
              <Link
                to="/admin/d/$host/offers"
                params={{ host: offer.host }}
                className="rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {offer.host}
              </Link>
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">From</dt>
        <dd dir="auto" className="[overflow-wrap:anywhere]">
          {offer.name}
        </dd>
        <dt className="text-muted-foreground">Email</dt>
        <dd className="[overflow-wrap:anywhere]">{offer.email}</dd>
        {offer.country ? (
          <>
            <dt className="text-muted-foreground">Country</dt>
            <dd className="[overflow-wrap:anywhere]">{countryName(offer.country)}</dd>
          </>
        ) : null}
      </dl>
      {offer.message ? <Message text={offer.message} /> : <p className="text-sm text-muted-foreground">No message.</p>}
      {offer.emailStatus === "failed" ? (
        <Alert>
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>The notification email was not sent</AlertTitle>
          <AlertDescription className="[overflow-wrap:anywhere]">
            This offer is only here in the inbox.{offer.emailError ? ` Error: ${offer.emailError}` : ""}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <a href={replyHref(offer.email, offer.host)}>
            <Mail aria-hidden="true" />
            Reply by email
          </a>
        </Button>
        {others.map((status) => (
          <Button
            key={status}
            variant="outline"
            size="sm"
            aria-disabled={props.busy}
            onClick={() => {
              if (!props.busy) props.onStatus(status);
            }}
          >
            {actionLabel[status]}
          </Button>
        ))}
      </div>
      {props.error ? (
        <p role="alert" className="text-sm text-destructive">
          {props.error}
        </p>
      ) : null}
    </li>
  );
}

type Page = { offers: Offer[]; next: OfferCursor | null; now: number };

/**
 * The inbox: offers newest first, with "Load more". Mount it with a `key` made of the filter, so a new filter
 * starts from the loader's first page again.
 */
export function OfferList(props: { first: Page; filter: OfferFilter; showHost: boolean; empty: ReactNode }) {
  const router = useRouter();
  const loadPage = useServerFn(getOffers);
  const changeStatus = useServerFn(setOfferStatus);
  const [offers, setOffers] = useState(props.first.offers);
  const [next, setNext] = useState(props.first.next);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const setStatusOf = (id: string, status: OfferStatus) =>
    setOffers((current) => current.map((offer) => (offer.id === id ? { ...offer, status } : offer)));

  async function onStatus(offer: Offer, status: OfferStatus) {
    const previous = offer.status;
    setBusy((current) => new Set(current).add(offer.id));
    setErrors(({ [offer.id]: _, ...rest }) => rest);
    setStatusOf(offer.id, status);
    try {
      const result = await changeStatus({ data: { id: offer.id, status } });
      if (!result.ok) throw new Error("gone");
      // The badge in the navigation counts new offers.
      await router.invalidate();
    } catch {
      setStatusOf(offer.id, previous);
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
      const page = await loadPage({ data: { ...props.filter, before: next } });
      setOffers((current) => [...current, ...page.offers]);
      setNext(page.next);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  if (offers.length === 0) return <>{props.empty}</>;
  return (
    <>
      <ul className="flex flex-col gap-3">
        {offers.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            now={props.first.now}
            showHost={props.showHost}
            busy={busy.has(offer.id)}
            error={errors[offer.id]}
            onStatus={(status) => void onStatus(offer, status)}
          />
        ))}
      </ul>
      <div className="mt-6 flex flex-col items-center gap-2" aria-live="polite">
        {next !== null ? (
          <Button variant="outline" aria-disabled={loading} onClick={() => void loadMore()}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            {offers.length === 1 ? "That is the only offer." : `That is all ${offers.length} offers.`}
          </p>
        )}
        {loadError ? <p className="text-sm text-destructive">Older offers could not be loaded. Try again.</p> : null}
      </div>
    </>
  );
}

export function NoOffers({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <h2 className="font-medium">{filtered ? "No offers match this filter" : "No offers yet"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {filtered
          ? "Pick another status or domain to see more."
          : "When a visitor sends an offer from one of your pages, it shows up here and in your email."}
      </p>
    </div>
  );
}
