import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@deparked/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@deparked/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@deparked/ui/sheet";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Globe, Inbox, LogOut, Menu, Plus, Search, Settings } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { DomainSummary } from "../server/domains";
import { StatusDot, statusLabel } from "./status";
import { ThemeToggle } from "./theme";

type ShellData = { domains: DomainSummary[]; newOffers: number; tokenRejected: boolean };

const NAV_LINK =
  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-secondary aria-[current=page]:text-foreground";

function NewOffersBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Badge className="tabular-nums">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> new</span>
    </Badge>
  );
}

function MainNav({ newOffers, onNavigate }: { newOffers: number; onNavigate?: () => void }) {
  return (
    <>
      <Link to="/admin" activeOptions={{ exact: true }} className={NAV_LINK} onClick={onNavigate}>
        Overview
      </Link>
      <Link to="/admin/inbox" className={NAV_LINK} onClick={onNavigate}>
        Inbox
        <NewOffersBadge count={newOffers} />
      </Link>
      <Link to="/admin/settings" className={NAV_LINK} onClick={onNavigate}>
        Settings
      </Link>
    </>
  );
}

function WorkspaceSwitcher({ domains, current }: { domains: DomainSummary[]; current: DomainSummary | undefined }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-40 justify-start gap-2 px-2 lg:max-w-72" aria-label="Switch domain">
          {current ? <StatusDot status={current.status} /> : <Globe aria-hidden="true" />}
          <span className="truncate">{current?.host ?? "All domains"}</span>
          <ChevronsUpDown className="ml-auto text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuItem asChild>
          <Link to="/admin">
            <Globe aria-hidden="true" />
            All domains
            {current ? null : <Check className="ml-auto" aria-hidden="true" />}
          </Link>
        </DropdownMenuItem>
        {domains.length > 0 ? <DropdownMenuSeparator /> : null}
        {domains.map((domain) => (
          <DropdownMenuItem key={domain.host} asChild>
            <Link to="/admin/d/$host" params={{ host: domain.host }}>
              <StatusDot status={domain.status} />
              <span className="truncate">{domain.host}</span>
              <span className="sr-only">, {statusLabel(domain.status)}</span>
              {current?.host === domain.host ? <Check className="ml-auto" aria-hidden="true" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/admin/add">
            <Plus aria-hidden="true" />
            Add domain
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Phones: the switcher and the navigation live in one sheet. */
function MobileMenu({ data, current }: { data: ShellData; current: DomainSummary | undefined }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu">
          <Menu aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[85vw] gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Deparked</SheetTitle>
          <SheetDescription className="sr-only">Pages and domains</SheetDescription>
        </SheetHeader>
        <nav aria-label="Main" className="flex flex-col items-stretch gap-1 px-2">
          <MainNav newOffers={data.newOffers} onNavigate={close} />
        </nav>
        <nav aria-label="Domains" className="mt-4 flex flex-col gap-1 border-t px-2 pt-4">
          <h2 className="px-3 pb-1 text-xs font-medium text-muted-foreground">Domains</h2>
          {data.domains.map((domain) => (
            <Link
              key={domain.host}
              to="/admin/d/$host"
              params={{ host: domain.host }}
              className={NAV_LINK}
              aria-current={current?.host === domain.host ? "page" : undefined}
              onClick={close}
            >
              <StatusDot status={domain.status} />
              <span className="min-w-0 [overflow-wrap:anywhere]">{domain.host}</span>
              <span className="sr-only">, {statusLabel(domain.status)}</span>
            </Link>
          ))}
          <Link to="/admin/add" className={NAV_LINK} onClick={close}>
            <Plus className="size-4" aria-hidden="true" />
            Add domain
          </Link>
        </nav>
        <form method="post" action="/admin/logout" className="mt-4 border-t p-4">
          <Button type="submit" variant="outline" className="w-full">
            Log out
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function CommandPalette({ domains, onLogOut }: { domains: DomainSummary[]; onLogOut: () => void }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <>
      <Button
        variant="outline"
        className="gap-2 px-2.5 text-muted-foreground lg:w-56 lg:justify-start"
        aria-label="Search domains and pages"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden="true" />
        <span className="hidden lg:inline">Search…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-sans text-xs lg:inline">⌘K</kbd>
      </Button>
      {/* Mounted only while open: the dialog's title would otherwise sit in every page as a stray heading. */}
      {open ? (
        <CommandDialog open onOpenChange={setOpen} title="Go to" description="Jump to a domain or a page">
          <CommandInput placeholder="Search domains and pages…" />
          <CommandList>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup heading="Pages">
              <CommandItem onSelect={run(() => navigate({ to: "/admin" }))}>
                <Globe aria-hidden="true" />
                All domains
              </CommandItem>
              <CommandItem onSelect={run(() => navigate({ to: "/admin/inbox" }))}>
                <Inbox aria-hidden="true" />
                Inbox
              </CommandItem>
              <CommandItem onSelect={run(() => navigate({ to: "/admin/settings" }))}>
                <Settings aria-hidden="true" />
                Settings
              </CommandItem>
              <CommandItem onSelect={run(() => navigate({ to: "/admin/add" }))}>
                <Plus aria-hidden="true" />
                Add domain
              </CommandItem>
            </CommandGroup>
            {domains.length > 0 ? (
              <CommandGroup heading="Domains">
                {domains.map((domain) => (
                  <CommandItem
                    key={domain.host}
                    value={domain.host}
                    onSelect={run(() => navigate({ to: "/admin/d/$host", params: { host: domain.host } }))}
                  >
                    <StatusDot status={domain.status} className="mx-1.5" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{domain.host}</span>
                    <span className="ml-auto pl-2 text-xs whitespace-nowrap text-muted-foreground">
                      {statusLabel(domain.status)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Account">
              <CommandItem onSelect={run(onLogOut)}>
                <LogOut aria-hidden="true" />
                Log out
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      ) : null}
    </>
  );
}

/** The frame of every logged-in screen: skip link, workspace switcher, navigation, ⌘K, theme, log out. */
export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const { host } = useParams({ strict: false });
  const current = data.domains.find((domain) => domain.host === host);
  const logoutForm = useRef<HTMLFormElement>(null);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1 px-2 sm:px-4">
          <MobileMenu data={data} current={current} />
          <div className="hidden md:block">
            <WorkspaceSwitcher domains={data.domains} current={current} />
          </div>
          <p className="flex min-w-0 items-center gap-2 px-1 text-sm font-medium md:hidden">
            {current ? <StatusDot status={current.status} /> : null}
            <span className="truncate">{current?.host ?? "All domains"}</span>
          </p>
          <nav aria-label="Main" className="ml-2 hidden items-center gap-1 md:flex">
            <MainNav newOffers={data.newOffers} />
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <CommandPalette domains={data.domains} onLogOut={() => logoutForm.current?.submit()} />
            <ThemeToggle />
            <form ref={logoutForm} method="post" action="/admin/logout" className="hidden md:block">
              <Button type="submit" variant="ghost">
                Log out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:py-8">
        {data.tokenRejected ? (
          <div role="alert" className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium text-destructive">Cloudflare rejects the saved API token.</p>
            <p className="mt-1 text-muted-foreground">
              Your pages stay online, but publishing and domain changes stop until you{" "}
              <Link
                to="/admin/settings/cloudflare"
                className="font-medium text-foreground underline underline-offset-4"
              >
                replace the token
              </Link>
              .
            </p>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
