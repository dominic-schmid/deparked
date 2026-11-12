// Simplified drawings, not screenshots: Cloudflare's dashboard changes, the three clicks do not.
import { ArrowDown, ArrowRight, Cloud, Laptop, MousePointer2 } from "lucide-react";
import type { ReactNode } from "react";

function Node(props: { icon: ReactNode; title: string; detail: string; accent?: boolean }) {
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-xl border p-3.5 sm:flex-col sm:items-start sm:gap-2.5 sm:p-4 ${
        props.accent === true ? "border-primary/30 bg-card shadow-[0_6px_20px_-12px_rgb(0_0_0/0.25)]" : "bg-card"
      }`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
        {props.icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">{props.title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{props.detail}</span>
      </span>
    </div>
  );
}

function Link(props: { label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 py-1.5 pl-7 text-xs text-muted-foreground sm:w-[7.5rem] sm:flex-col sm:justify-center sm:gap-1.5 sm:px-2 sm:py-0 sm:text-center">
      <ArrowDown aria-hidden className="size-4 sm:hidden" />
      <ArrowRight aria-hidden className="hidden size-4 sm:block" />
      <span className="text-balance sm:leading-snug">{props.label}</span>
    </div>
  );
}

function DeparkedMark() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.5" y="4" width="15" height="12" rx="2.5" />
      <path d="M6 8.5h5M6 11.5h8" strokeLinecap="round" />
    </svg>
  );
}

/** Why the key is needed: you, Deparked in your account, Cloudflare. */
export function TokenDiagram() {
  return (
    <figure
      className="flex flex-col sm:flex-row sm:items-stretch"
      aria-label="You paste the token into this page once. Deparked, running in your own Cloudflare account, uses it to publish your pages and set up your domains through Cloudflare."
    >
      <Node icon={<Laptop aria-hidden className="size-[18px]" />} title="You" detail="in this browser" />
      <Link label="paste the token once" />
      <Node icon={<DeparkedMark />} title="Deparked" detail="in your Cloudflare account" accent />
      <Link label="publishes pages, sets up domains" />
      <Node icon={<Cloud aria-hidden className="size-[18px]" />} title="Cloudflare" detail="serves your pages" />
    </figure>
  );
}

function Window(props: { children: ReactNode }) {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-lg border bg-card text-[10px] leading-none shadow-[0_1px_0_rgb(0_0_0/0.03),0_8px_24px_-12px_rgb(0_0_0/0.18)]"
    >
      <div className="flex items-center gap-1.5 border-b bg-muted/60 px-2.5 py-2">
        <span className="size-1.5 rounded-full bg-foreground/15" />
        <span className="size-1.5 rounded-full bg-foreground/15" />
        <span className="size-1.5 rounded-full bg-foreground/15" />
        <span className="ml-1.5 truncate rounded bg-background/80 px-1.5 py-0.5 text-[9px] text-muted-foreground">
          dash.cloudflare.com
        </span>
      </div>
      <div className="flex h-[140px] flex-col gap-2 p-3 pb-4">{props.children}</div>
    </div>
  );
}

const Bar = (props: { w: string }) => <span className={`block h-1.5 rounded-full bg-foreground/10 ${props.w}`} />;

function Target(props: { label: string; wide?: boolean }) {
  return (
    <span className="relative mt-auto inline-flex self-start">
      <span
        className={`rounded-md bg-[oklch(0.6_0.15_250)] px-2.5 py-1.5 font-semibold text-white ring-[3px] ring-[oklch(0.6_0.15_250)]/30 ${
          props.wide === true ? "min-w-24" : ""
        }`}
      >
        {props.label}
      </span>
      <MousePointer2 className="absolute -right-3 -bottom-3 size-4 fill-foreground stroke-background" />
    </span>
  );
}

function Chip(props: { label: string }) {
  return (
    <span className="flex items-center justify-between gap-2 rounded border px-1.5 py-1">
      <span className="truncate text-muted-foreground">{props.label}</span>
      <span className="shrink-0 rounded-sm bg-secondary px-1 py-0.5 text-[8px] font-medium">Edit</span>
    </span>
  );
}

/** The three clicks on Cloudflare's Create Token page, in order. */
export function TokenPagePictures() {
  return (
    <ol className="grid gap-4 sm:grid-cols-3">
      <li className="flex flex-col gap-2.5">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">1.</span> Check the filled-in form, scroll to the end, then{" "}
          <strong className="font-semibold">Continue to summary</strong>.
        </p>
        <Window>
          <span className="font-semibold text-foreground/80">Create Custom Token</span>
          <Chip label="Workers Scripts" />
          <Chip label="D1" />
          <span className="text-center text-muted-foreground">⋯</span>
          <Target label="Continue to summary" />
        </Window>
      </li>
      <li className="flex flex-col gap-2.5">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">2.</span> On the summary, press{" "}
          <strong className="font-semibold">Create Token</strong>.
        </p>
        <Window>
          <span className="font-semibold text-foreground/80">Deparked summary</span>
          <Bar w="w-11/12" />
          <Bar w="w-9/12" />
          <Bar w="w-10/12" />
          <Target label="Create Token" wide />
        </Window>
      </li>
      <li className="flex flex-col gap-2.5">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">3.</span> <strong className="font-semibold">Copy</strong> the
          token. Cloudflare shows it only once.
        </p>
        <Window>
          <span className="font-semibold text-foreground/80">Token created</span>
          <span className="flex items-center gap-1.5 rounded border px-1.5 py-1.5">
            <span className="truncate font-mono tracking-widest text-muted-foreground">••••••••••••••••</span>
          </span>
          <Bar w="w-8/12" />
          <Target label="Copy" />
        </Window>
      </li>
    </ol>
  );
}
