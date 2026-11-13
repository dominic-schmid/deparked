// Simplified drawings, not screenshots: Cloudflare's dashboard changes, the three clicks do not.
import { Journey } from "@deparked/ui/flow";
import { MousePointer2 } from "lucide-react";
import type { ReactNode } from "react";

const TILE = "aspect-[4/3] w-full rounded-[14px]";

/** Why the key is needed: you paste it once, Deparked keeps it in your account, Cloudflare serves the pages. */
export function TokenDiagram() {
  return (
    <Journey
      label="How the token is used"
      note="It goes from this tab into your own account, as a secret of your admin panel. Nobody else sees it."
      stages={[
        {
          caption: "You paste a token once",
          picture: (
            <div className={`${TILE} flex flex-col gap-1.5 bg-background p-2`}>
              <span className="flex gap-1">
                <span className="size-1.5 rounded-full bg-border" />
                <span className="size-1.5 rounded-full bg-border" />
              </span>
              <span className="flex flex-1 items-center justify-center rounded-[9px] bg-card px-2">
                <span className="w-full truncate rounded-full bg-tangerine px-2 py-1 text-center font-mono text-[9px] leading-none tracking-[0.2em] text-tangerine-foreground">
                  ••••••
                </span>
              </span>
            </div>
          ),
        },
        {
          caption: "Deparked keeps it in your account",
          picture: (
            <div className={`${TILE} grid place-items-center bg-[#14162b] dark:bg-secondary`}>
              <span className="flex w-1/2 flex-col gap-1.5">
                <span className="h-2 w-full rounded-full bg-tangerine" />
                <span className="h-2 w-2/3 rounded-full bg-[#f3f5fa]" />
              </span>
            </div>
          ),
        },
        {
          caption: "Cloudflare serves your pages",
          picture: (
            <div className={`${TILE} grid place-items-center bg-tangerine/15`}>
              <svg
                aria-hidden="true"
                viewBox="0 0 64 40"
                className="w-3/5"
                fill="none"
                strokeWidth="2.2"
                strokeLinejoin="round"
              >
                <path
                  d="M16 36h34a11 11 0 0 0 1-21.95A15 15 0 0 0 22.5 10 12 12 0 0 0 16 36Z"
                  className="fill-card stroke-foreground"
                />
                <path d="M24 26h16M24 20h10" className="stroke-tangerine" strokeLinecap="round" />
              </svg>
            </div>
          ),
        },
      ]}
    />
  );
}

function Window(props: { children: ReactNode }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-2xl bg-card text-[10px] leading-none shadow-lift">
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
