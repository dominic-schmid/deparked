import { cn } from "@deparked/ui/lib/utils";
import { createFileRoute, getRouteApi, Link, Outlet, useMatch, useSearch } from "@tanstack/react-router";
import { ChevronLeft, CloudCog, Download, KeyRound, type LucideIcon, Mail, Trash2 } from "lucide-react";
import { PageError, PagePending } from "../../../components/page";
import { getNotifyAddresses } from "../../../server/notify.functions";
import { getUpdates } from "../../../server/updates/functions";

const shellRoute = getRouteApi("/admin/_shell");

/**
 * Settings: the sections as a list, each with a one-line live status, and the chosen one beside it. On a phone the
 * list is the page and a section opens as a page of its own. The status lines read the database only; the
 * Cloudflare token is checked by its own section.
 */
export const Route = createFileRoute("/admin/_shell/settings")({
  loader: async () => {
    const [notify, updates] = await Promise.all([
      getNotifyAddresses(),
      // A status line must never take the sections down with it.
      getUpdates().catch(() => null),
    ]);
    return { notify, updates };
  },
  head: () => ({ meta: [{ title: "Settings · Deparked" }] }),
  component: SettingsLayout,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

type Tone = "positive" | "caution" | "tangerine" | "negative" | null;

const DOT: Record<Exclude<Tone, null>, string> = {
  positive: "bg-positive",
  caution: "bg-caution",
  tangerine: "bg-tangerine",
  negative: "bg-negative",
};

type Row = {
  to: "/admin/settings" | `/admin/settings/${"password" | "cloudflare" | "updates" | "danger"}`;
  name: string;
  icon: LucideIcon;
  status: string;
  tone: Tone;
};

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
}

function useRows(): Row[] {
  const { notify, updates } = Route.useLoaderData();
  const { tokenRejected } = shellRoute.useLoaderData();
  const cloudflare = useMatch({ from: "/admin/_shell/settings/cloudflare", shouldThrow: false });

  const confirmed = notify.addresses.filter((address) => address.verifiedAt !== null).length;
  const waiting = notify.addresses.length - confirmed;
  const offers: Pick<Row, "status" | "tone"> =
    notify.addresses.length === 0
      ? { status: "Add the address offers go to", tone: "caution" }
      : waiting === 0
        ? { status: `${plural(confirmed, "address", "addresses")} confirmed`, tone: "positive" }
        : confirmed === 0
          ? { status: `${plural(waiting, "address", "addresses")} waiting for you`, tone: "caution" }
          : { status: `${confirmed} confirmed, ${waiting} waiting`, tone: "caution" };

  // The section's own check is the freshest; elsewhere the shell's knows whether Cloudflare refuses the token.
  const health = cloudflare?.loaderData?.ok === true ? cloudflare.loaderData.value.state : null;
  const token: Pick<Row, "status" | "tone"> =
    health === "incomplete"
      ? { status: "Needs more permissions", tone: "caution" }
      : health === "rejected" || (health === null && tokenRejected)
        ? { status: "Rejected: paste a new token", tone: "negative" }
        : { status: health === "ok" ? "Working" : "Connected", tone: "positive" };

  const view = updates?.ok === true ? updates.value : null;
  const unfinished = view?.status.change != null && !view.status.change.finished ? view.status.change : null;
  const release: Pick<Row, "status" | "tone"> =
    view === null
      ? { status: "Open to check for updates", tone: null }
      : unfinished !== null
        ? { status: `Going to ${unfinished.pin.version} did not finish`, tone: "caution" }
        : view.available && view.latest !== null
          ? { status: `Version ${view.latest.version} is ready`, tone: "tangerine" }
          : view.status.installed === null
            ? { status: "Development build", tone: null }
            : { status: `Up to date: ${view.status.installed.version}`, tone: "positive" };

  return [
    { to: "/admin/settings", name: "Where offers go", icon: Mail, ...offers },
    {
      to: "/admin/settings/password",
      name: "Password",
      icon: KeyRound,
      status: "Change it, or log out everywhere",
      tone: null,
    },
    { to: "/admin/settings/cloudflare", name: "Cloudflare connection", icon: CloudCog, ...token },
    { to: "/admin/settings/updates", name: "Updates", icon: Download, ...release },
    {
      to: "/admin/settings/danger",
      name: "Remove Deparked",
      icon: Trash2,
      status: "Takes everything down",
      tone: null,
    },
  ];
}

const ROW =
  "group flex min-h-[4.5rem] w-full items-center gap-3.5 rounded-[18px] p-3.5 outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-tangerine/12 motion-reduce:transition-none";

function SectionList({ rows }: { rows: Row[] }) {
  return (
    <nav aria-label="Settings" className="rounded-[24px] bg-card p-2 shadow-lift">
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.to}>
            <Link
              to={row.to}
              // The first section is the settings page itself; a phone opens it with `?section=offers`.
              {...(row.to === "/admin/settings" ? { search: { section: "offers" as const } } : {})}
              activeOptions={{ exact: true, includeSearch: false }}
              className={ROW}
            >
              <span
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-secondary group-aria-[current=page]:bg-tangerine/25"
              >
                <row.icon className="size-5" strokeWidth={2} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="font-semibold">{row.name}</span>
                <span className="truncate text-[13.5px] text-muted-foreground">{row.status}</span>
              </span>
              <span
                aria-hidden="true"
                className={cn("size-2.5 shrink-0 rounded-full", row.tone === null ? "invisible" : DOT[row.tone])}
              />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SettingsLayout() {
  const rows = useRows();
  const index = useMatch({ from: "/admin/_shell/settings/", shouldThrow: false }) !== undefined;
  const search: { section?: unknown } = useSearch({ strict: false });
  // On a phone the bare settings page is the list; any other settings address is a section.
  const opened = !index || search.section === "offers";
  return (
    <div className="flex flex-col gap-7">
      <h1
        className={cn(
          "font-heading text-[clamp(2rem,1.6rem+1.6vw,2.25rem)] leading-tight font-bold tracking-[-0.02em]",
          opened && "max-md:sr-only",
        )}
      >
        Settings
      </h1>
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className={cn("min-w-0 md:sticky md:top-6", opened && "max-md:hidden")}>
          <SectionList rows={rows} />
        </div>
        <div className={cn("flex min-w-0 flex-col gap-4", !opened && "max-md:hidden")}>
          <Link
            to="/admin/settings"
            className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-full bg-card pr-4 pl-2.5 text-sm font-semibold shadow-rest outline-none hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 md:hidden"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
            All settings
          </Link>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
