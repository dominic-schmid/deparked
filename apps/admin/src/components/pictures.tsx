import { Journey, PathArrow } from "@deparked/ui/flow";
import { cn } from "@deparked/ui/lib/utils";
import {
  ChartLine,
  Check,
  Clock,
  Globe,
  type LucideIcon,
  Mail,
  MapPin,
  PanelsTopLeft,
  ShieldCheck,
  Wrench,
} from "lucide-react";

// Drawings for the first run and "Add domain": the picture comes first, the words after (design rule 3). Every
// drawing is decorative; the text next to it carries the meaning.

const TILE = "aspect-[4/3] w-full rounded-[14px]";

export type OfferPathState = "ask" | "pending" | "verified";

/**
 * Where an offer goes: a buyer's offer on the page, an email to the owner, the owner's reply. While the address
 * waits for its confirmation the email carries a clock, once confirmed a tick.
 */
export function OfferPath({ state }: { state: OfferPathState }) {
  return (
    <Journey
      label="How an offer reaches you"
      note="Offers are saved here even if an email goes missing."
      stages={[
        {
          caption: "A buyer makes an offer",
          picture: (
            <div
              className={cn(
                TILE,
                "flex flex-col justify-between bg-[linear-gradient(160deg,#5b7fb8,#e9c98b_70%,#5e7a3a)] px-2.5 py-2 text-white outline outline-1 -outline-offset-1 outline-black/10",
              )}
            >
              <span className="text-[7px] font-semibold tracking-[0.1em]">FOR SALE</span>
              <span className="font-heading text-[clamp(0.6rem,2.6vw,0.8125rem)] font-bold">yours.com</span>
            </div>
          ),
        },
        {
          caption: "You get an email",
          picture: (
            <>
              <div className={cn(TILE, "grid place-items-center bg-tangerine/15")}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 58 44"
                  className="w-1/2"
                  fill="none"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="2" width="54" height="40" rx="6" className="fill-card stroke-foreground" />
                  <path d="m3 5 26 20L55 5" className="stroke-foreground" />
                </svg>
              </div>
              <span className="absolute -top-2.5 -right-2 rotate-6 rounded-[9px] bg-tangerine px-2 py-0.5 text-[12px] font-semibold text-tangerine-foreground shadow-lift">
                $2,500
              </span>
              {state === "ask" ? null : (
                <span
                  className={cn(
                    "absolute -bottom-2 -left-2 grid size-7 place-items-center rounded-full text-tangerine-foreground shadow-lift ring-2 ring-card",
                    state === "verified" ? "bg-positive" : "bg-caution",
                  )}
                >
                  {state === "verified" ? (
                    <Check className="size-4" strokeWidth={3} />
                  ) : (
                    <Clock className="size-4" strokeWidth={2.4} />
                  )}
                </span>
              )}
            </>
          ),
        },
        {
          caption: "You reply and agree a price",
          picture: (
            <div className={cn(TILE, "flex flex-col justify-center gap-[7px] bg-[#14162b] px-3.5 dark:bg-secondary")}>
              <span className="h-2 w-[70%] rounded bg-tangerine" />
              <span className="h-2 w-full rounded bg-[#4a4f6b]" />
              <span className="h-2 w-[55%] rounded bg-[#4a4f6b]" />
            </div>
          ),
        },
      ]}
    />
  );
}

/** The password step: the admin as a locked window that only its owner opens. */
export function LockedAdmin() {
  return (
    <div className="flex flex-col gap-6 rounded-[32px] bg-card p-5 shadow-lift sm:p-8">
      <div aria-hidden="true" className="relative mx-auto w-full max-w-sm">
        <div className="rounded-[20px] bg-background p-2">
          <div className="flex items-center gap-1.5 px-1.5 pt-0.5 pb-2">
            <span className="size-2 rounded-full bg-border" />
            <span className="size-2 rounded-full bg-border" />
            <span className="ml-1.5 h-4 flex-1 rounded-full bg-card" />
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-[14px] bg-card p-3">
            {["#5b7fb8", "#1f9d6b", "#14162b"].map((colour) => (
              <span key={colour} className="flex flex-col gap-1.5">
                <span className="aspect-[4/3] rounded-lg" style={{ background: colour }} />
                <span className="h-1.5 w-3/4 rounded bg-border" />
              </span>
            ))}
          </div>
        </div>
        <span className="absolute -right-3 -bottom-4 grid size-14 rotate-6 place-items-center rounded-2xl bg-tangerine text-tangerine-foreground shadow-lift">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
          >
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
          </svg>
        </span>
      </div>
      <p className="flex items-start gap-3 border-t pt-5 text-sm text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-px size-5 shrink-0 text-positive" />
        <span>Only you get in here. Buyers see your for-sale pages, never this.</span>
      </p>
    </div>
  );
}

/** What adding a domain sets up, grouped the way the owner thinks of it. Steps without a group are bookkeeping. */
type GroupKey = "page" | "bot" | "visits" | "email" | "address";

const GROUP_OF: Record<string, GroupKey> = {
  "publish-placeholder": "page",
  "bot-check": "bot",
  analytics: "visits",
  email: "email",
  routes: "address",
  rewrite: "address",
  "www-redirect": "address",
  dns: "address",
};

/** Steps that only check or record: they appear in the detailed list, not in the picture. */
const BOOKKEEPING = new Set(["register", "ready"]);

/** The page first: it is what the owner came for. Unknown steps go last, in their own order. */
const ORDER: readonly GroupKey[] = ["page", "bot", "visits", "email", "address"];

const GROUPS: Record<GroupKey, { label: string; short: string; icon: LucideIcon }> = {
  page: { label: "A for-sale page", short: "page", icon: PanelsTopLeft },
  bot: { label: "A bot check on its offer form", short: "bot check", icon: ShieldCheck },
  visits: { label: "Visit counts", short: "visits", icon: ChartLine },
  email: { label: "Offer emails", short: "email", icon: Mail },
  address: { label: "Its address, pointed at the page", short: "address", icon: MapPin },
};

export type SetupItem = { key: string; label: string; short: string; icon: LucideIcon; done: boolean };

/**
 * The steps of adding a domain as a few things the owner recognises: page, bot check, visits, email, address. A thing
 * is `done` when every step in it already was. Unknown steps keep their own title.
 */
export function setupItems(steps: readonly { id: string; title: string; status?: string }[]): SetupItem[] {
  const items = new Map<string, SetupItem>();
  for (const step of steps) {
    if (BOOKKEEPING.has(step.id)) continue;
    const key = GROUP_OF[step.id];
    const group = key === undefined ? null : GROUPS[key];
    const id = key ?? step.id;
    const done = step.status === "done";
    const known = items.get(id);
    if (known !== undefined) {
      known.done = known.done && done;
      continue;
    }
    items.set(
      id,
      group === null
        ? { key: id, label: step.title, short: step.title.toLowerCase(), icon: Wrench, done }
        : { key: id, ...group, done },
    );
  }
  const rank = (key: string) => {
    const at = ORDER.indexOf(key as GroupKey);
    return at === -1 ? ORDER.length : at;
  };
  return [...items.values()].sort((a, b) => rank(a.key) - rank(b.key));
}

/** "Page, bot check, visits, email, address". */
export function itemsSummary(items: readonly SetupItem[]): string {
  const text = items.map((item) => item.short).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The things as a row of icon tiles with their names: the short form of the review. */
export function SetupItemList({ items, label }: { items: readonly SetupItem[]; label: string }) {
  return (
    <ul aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.key} className="flex min-w-0 items-center gap-3 rounded-2xl bg-card p-2.5 pr-4 shadow-rest">
            <span
              aria-hidden="true"
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-[11px]",
                item.done ? "bg-secondary text-muted-foreground" : "bg-positive/15 text-[var(--success)]",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={2} />
            </span>
            <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
              {item.label}
              {item.done ? <span className="font-normal text-muted-foreground"> · already there</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export type TodayState = "nothing" | "website" | "app";

/** Before and after: what the address shows today, and the for-sale page it shows once added. */
export function BeforeAfter({ host, today }: { host: string; today: TodayState }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-3 sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="aspect-[4/3] w-full rounded-[18px] bg-card p-3 shadow-rest">
          {today === "nothing" ? (
            <div className="grid h-full place-items-center rounded-[10px] border-2 border-dashed border-input">
              <Globe className="size-6 text-muted-foreground/60" />
            </div>
          ) : (
            <div className="flex h-full flex-col gap-2 rounded-[10px] bg-secondary p-3">
              <span className="h-2 w-1/2 rounded bg-input" />
              <span className="h-2 w-full rounded bg-border" />
              <span className="h-2 w-5/6 rounded bg-border" />
              {today === "app" ? <span className="mt-auto h-5 w-12 rounded-md bg-input" /> : null}
            </div>
          )}
        </div>
        <span className="text-center text-[13px] font-semibold text-muted-foreground">Today</span>
      </div>
      <PathArrow className="mb-7 w-8 sm:w-11" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="aspect-[4/3] w-full rounded-[18px] bg-card p-3 shadow-lift">
          <div className="flex h-full flex-col justify-between rounded-[10px] bg-[#14162b] px-3 py-2.5 text-white">
            <span className="text-[8px] font-semibold tracking-[0.14em] text-[#c9cee6]">FOR SALE</span>
            <span translate="no" className="truncate font-heading text-[clamp(0.75rem,2.4vw,1rem)] font-bold">
              {host}
            </span>
            <span className="h-1.5 w-2/3 rounded bg-tangerine" />
          </div>
        </div>
        <span className="text-center text-[13px] font-semibold">With Deparked</span>
      </div>
    </div>
  );
}
