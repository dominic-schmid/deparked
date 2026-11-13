import { type CommandItem, CommandPalette } from "@deparked/ui/arc/command-palette";
import { Dialog, DialogContent } from "@deparked/ui/arc/dialog";
import { useNavigate } from "@tanstack/react-router";
import { Globe, Inbox, LogOut, Plus, Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { DomainSummary } from "../server/domains";
import { StatusDot, statusLabel } from "./status";

const PAGES = [
  { to: "/admin", label: "Domains", icon: <Globe className="size-4" />, keywords: ["home", "all domains"] },
  { to: "/admin/inbox", label: "Offers", icon: <Inbox className="size-4" />, keywords: ["inbox"] },
  { to: "/admin/settings", label: "Settings", icon: <Settings className="size-4" />, keywords: ["password"] },
  { to: "/admin/add", label: "Add a domain", icon: <Plus className="size-4" />, keywords: ["new"] },
] as const;

/**
 * Search: every page and every domain, by keyboard. The search button and ⌘K / Ctrl+K open it; ⌘K again, Escape or a
 * click outside close it. Arc's command palette in Arc's dialog.
 */
export function CommandMenu({ domains, onLogOut }: { domains: DomainSummary[]; onLogOut: () => void }) {
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

  const items: CommandItem[] = [
    ...PAGES.map((page) => ({
      id: `page:${page.to}`,
      label: page.label,
      icon: page.icon,
      keywords: [...page.keywords],
      group: "Pages",
    })),
    ...domains.map((domain) => ({
      id: `domain:${domain.host}`,
      label: domain.host,
      description: statusLabel(domain.status),
      group: "Domains",
      icon: <StatusDot status={domain.status} />,
    })),
    { id: "logout", label: "Log out", group: "Account", icon: <LogOut className="size-4" />, keywords: ["sign out"] },
  ];

  const select = (item: CommandItem) => {
    setOpen(false);
    if (item.id === "logout") onLogOut();
    else if (item.id.startsWith("domain:")) navigate({ to: "/admin/d/$host", params: { host: item.id.slice(7) } });
    else {
      const page = PAGES.find((candidate) => `page:${candidate.to}` === item.id);
      if (page) navigate({ to: page.to });
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Search domains and pages"
        aria-keyshortcuts="Meta+K Control+K"
        title="Search (⌘K)"
        onClick={() => setOpen(true)}
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-card text-foreground shadow-rest transition-[background-color,scale] duration-150 hover:bg-hover active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <Search className="size-[18px]" aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* The palette brings its own surface, search field and Escape handling: the dialog adds the modal layer and
            the focus trap, and keeps its title for screen readers only. */}
        <DialogContent
          title="Search"
          description="Jump to a domain or a page"
          className="top-[12vh] mt-0 mb-auto w-[min(calc(100vw-2rem),36rem)] overflow-visible border-0 bg-transparent shadow-none [&>div:first-child]:sr-only [&>div:last-child]:p-0"
          onEscapeKeyDown={(event) => {
            // The palette clears a typed search first; Escape on an empty field closes.
            if (event.target instanceof HTMLInputElement && event.target.value !== "") event.preventDefault();
          }}
        >
          <CommandPalette
            items={items}
            label="Search domains and pages"
            placeholder="Search domains and pages…"
            autoFocus
            onSelect={select}
            onClose={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
