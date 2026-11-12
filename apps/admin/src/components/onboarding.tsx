import { cn } from "@deparked/ui/lib/utils";
import { Check, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { UntilHydrated } from "./hydrated";

// The installer's onboarding frame (apps/install/src/ui/parts.tsx), continued here for the first-run screens: the
// installer cannot share React code with the admin, so the two copies are kept alike by hand.

export const STAGES = ["Password", "Offers", "Domain"] as const;
export type Stage = (typeof STAGES)[number];

function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none">
        <rect x="1.5" y="3.5" width="21" height="17" rx="4.5" className="fill-primary" />
        <path d="M6.5 9.5h7M6.5 14h11" className="stroke-primary-foreground" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span translate="no" className="font-serif text-[19px] font-semibold tracking-[-0.01em]">
        Deparked
      </span>
    </span>
  );
}

function Stages(props: { current: Stage }) {
  const index = STAGES.indexOf(props.current);
  return (
    <ol className="flex items-center gap-1.5 text-xs sm:gap-3" aria-label="Setup progress">
      {STAGES.map((stage, position) => {
        const state = position < index ? "done" : position === index ? "current" : "next";
        return (
          <li key={stage} className="flex items-center gap-1.5" aria-current={state === "current" ? "step" : undefined}>
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full border text-[10px] font-semibold tabular-nums transition-colors",
                state === "done" && "border-primary bg-primary text-primary-foreground",
                state === "current" && "border-primary text-foreground",
                state === "next" && "text-muted-foreground",
              )}
            >
              {state === "done" ? <Check aria-hidden className="size-3" strokeWidth={3} /> : position + 1}
            </span>
            <span
              className={cn(
                "hidden sm:inline",
                state === "current" ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {stage}
              {state === "done" ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function OnboardingShell(props: { stage: Stage; children: ReactNode }) {
  return (
    <UntilHydrated>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to the setup
        </a>
        <header className="border-b">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
            <Wordmark />
            <Stages current={props.stage} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-10 pb-16 sm:px-6 sm:pt-14">
          {props.children}
        </main>
        <footer className="border-t">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-4 text-xs text-muted-foreground sm:px-6">
            <span>Deparked runs in your Cloudflare account. No server of ours is involved.</span>
            <form method="post" action="/admin/logout">
              <button
                type="submit"
                className="rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Log out
              </button>
            </form>
          </div>
        </footer>
      </div>
    </UntilHydrated>
  );
}

/** A screen's heading takes focus when the screen appears, so a screen reader announces where it is. */
export function ScreenTitle(props: { eyebrow?: string; title: string; children?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: false });
  }, []);
  return (
    <div className="mb-8 sm:mb-10">
      {props.eyebrow === undefined ? null : (
        <p className="mb-3 text-[13px] font-medium text-muted-foreground">{props.eyebrow}</p>
      )}
      <h1
        ref={ref}
        tabIndex={-1}
        className="font-serif text-[clamp(1.875rem,1.4rem+2vw,2.625rem)] leading-[1.08] font-semibold tracking-[-0.02em] text-balance outline-none [overflow-wrap:anywhere]"
      >
        {props.title}
      </h1>
      {props.children === undefined ? null : (
        <div className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          {props.children}
        </div>
      )}
    </div>
  );
}

export function Spinner(props: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn("onboarding-spin size-4", props.className)} />;
}

export function Screen(props: { children: ReactNode }) {
  return <div className="onboarding-in">{props.children}</div>;
}
