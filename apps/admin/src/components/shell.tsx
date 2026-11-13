import { AnnouncementBar } from "@deparked/ui/arc/announcement-bar";
import { UserMenu } from "@deparked/ui/arc/user-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@deparked/ui/dropdown-menu";
import { cn } from "@deparked/ui/lib/utils";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { Check, ChevronDown, Globe, Plus, Settings } from "lucide-react";
import { type ReactNode, useRef } from "react";
import type { DomainSummary } from "../server/domains";
import { CommandMenu } from "./command-menu";
import { StatusDot, statusLabel } from "./status";
import { useTheme } from "./theme";

type ShellData = {
  domains: DomainSummary[];
  newOffers: number;
  tokenRejected: boolean;
  /** Where offers are emailed, for the account menu's header; null before an address exists. */
  offersEmail: string | null;
};

/** The page's content width; the header lines up with it. */
export const CONTENT = "mx-auto w-full max-w-[1160px] px-4 sm:px-6 lg:px-10";

/** Deparked's mark: a sign with a tangerine line, as on a shop window. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 30 30" className={cn("size-[30px] shrink-0", className)}>
      <rect width="30" height="30" rx="9" className="fill-primary" />
      <rect x="7" y="10" width="16" height="3.5" rx="1.75" fill="#ff6a3d" />
      <rect x="7" y="16.5" width="10" height="3.5" rx="1.75" className="fill-background" />
    </svg>
  );
}

/** A pill in a row of section links. The router marks the current one with `aria-current`, which fills it. */
export const PILL =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium whitespace-nowrap text-foreground outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-primary aria-[current=page]:font-semibold aria-[current=page]:text-primary-foreground active:scale-[0.97] max-sm:min-h-11 max-sm:flex-1 max-sm:px-3 motion-reduce:transition-none";

/** The tangerine count of offers still marked new; nothing at zero. */
export function NewOffersCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="rounded-full bg-tangerine px-2 py-px text-xs font-semibold text-tangerine-foreground tabular-nums">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> new</span>
    </span>
  );
}

/** Domains, Offers, Settings as one row of pills. The section the page belongs to is filled. */
function MainNav({ newOffers }: { newOffers: number }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const section = /^\/admin\/(offers|inbox)(\/|$)/.test(path)
    ? "offers"
    : path.startsWith("/admin/settings")
      ? "settings"
      : "domains";
  const current = (name: string) => (section === name ? "page" : undefined);
  return (
    <nav
      aria-label="Main"
      className="order-last flex w-full gap-1 rounded-full bg-card p-1 shadow-rest sm:order-none sm:w-auto"
    >
      <Link to="/admin" activeOptions={{ exact: true }} className={PILL} aria-current={current("domains")}>
        Domains
      </Link>
      <Link to="/admin/offers" className={PILL} aria-current={current("offers")}>
        Offers
        <NewOffersCount count={newOffers} />
      </Link>
      <Link to="/admin/settings" className={PILL} aria-current={current("settings")}>
        Settings
      </Link>
    </nav>
  );
}

/** On a domain's pages: which domain this is, and a quick way to another one. */
function DomainSwitcher({ domains, current }: { domains: DomainSummary[]; current: DomainSummary }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Switch domain, current: ${current.host}`}
        className="inline-flex min-h-10 max-w-[min(18rem,calc(100vw-13rem))] min-w-0 cursor-pointer items-center gap-2 rounded-full bg-card pr-3 pl-3.5 text-sm font-medium shadow-rest outline-none hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-hover max-sm:min-h-11"
      >
        <StatusDot status={current.status} />
        <span className="truncate" translate="no">
          {current.host}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto">
        <DropdownMenuItem asChild>
          <Link to="/admin">
            <Globe aria-hidden="true" />
            All domains
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {domains.map((domain) => (
          <DropdownMenuItem key={domain.host} asChild>
            <Link to="/admin/d/$host" params={{ host: domain.host }}>
              <StatusDot status={domain.status} />
              <span className="truncate" translate="no">
                {domain.host}
              </span>
              <span className="sr-only">, {statusLabel(domain.status)}</span>
              {current.host === domain.host ? <Check className="ml-auto" aria-hidden="true" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/admin/add">
            <Plus aria-hidden="true" />
            Add a domain
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountMenu({ email, onLogOut }: { email: string | null; onLogOut: () => void }) {
  const [theme, setTheme] = useTheme();
  const navigate = useNavigate();
  return (
    <UserMenu
      // The workspace knows no name; the address offers go to is what identifies its owner.
      user={
        email === null
          ? { name: "Owner", email: "No address for offers yet" }
          : { name: email, email: "Offers are emailed here" }
      }
      theme={theme}
      onThemeChange={setTheme}
      items={[
        {
          label: "Settings",
          icon: <Settings size={16} strokeWidth={1.75} />,
          onSelect: () => navigate({ to: "/admin/settings" }),
        },
      ]}
      onSignOut={onLogOut}
      className="size-11 justify-center bg-card shadow-rest"
    />
  );
}

/** Shown on every screen while Cloudflare refuses the token: the pages stay up, changes stop. */
function TokenRejectedBar() {
  return (
    <div role="alert">
      <AnnouncementBar
        tone="inverted"
        dismissible={false}
        label="Cloudflare token"
        messages={[
          {
            id: "token-rejected",
            message: (
              <>
                <strong className="font-semibold">Cloudflare rejects the saved API token.</strong> Your pages stay
                online, but publishing and domain changes stop until you{" "}
                <Link to="/admin/settings/cloudflare" className="font-semibold underline underline-offset-4">
                  replace the token
                </Link>
                .
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

/** The frame of every logged-in screen: skip link, brand, navigation, search (⌘K), the account menu. */
export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const { host } = useParams({ strict: false });
  const current = data.domains.find((domain) => domain.host === host);
  const logoutForm = useRef<HTMLFormElement>(null);
  const logOut = () => logoutForm.current?.submit();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {data.tokenRejected ? <TokenRejectedBar /> : null}
      <header
        className={cn(
          CONTENT,
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pt-5 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/admin"
            className="flex shrink-0 items-center gap-2.5 rounded-xl font-heading text-xl font-bold tracking-[-0.01em] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <BrandMark />
            <span className={current ? "max-md:sr-only" : undefined}>Deparked</span>
          </Link>
          {current ? <DomainSwitcher domains={data.domains} current={current} /> : null}
        </div>
        <MainNav newOffers={data.newOffers} />
        <div className="flex items-center gap-2 sm:justify-self-end">
          <CommandMenu domains={data.domains} onLogOut={logOut} />
          <AccountMenu email={data.offersEmail} onLogOut={logOut} />
          <form ref={logoutForm} method="post" action="/admin/logout" className="hidden" />
        </div>
      </header>
      <main id="main" tabIndex={-1} className={cn(CONTENT, "flex-1 pt-8 pb-16 outline-none sm:pt-10")}>
        {children}
      </main>
    </div>
  );
}
