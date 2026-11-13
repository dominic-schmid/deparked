import { cn } from "@deparked/ui/lib/utils";
import { ChevronDown, Lock, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";
import { Stepper } from "#arc/stepper/stepper";

// The guided flows (the installer, the admin's first run and "Add domain") share one frame, one heading and the
// "shop window" pieces: a page in a browser window, the "Live now" tag and the one-time entrance on success.

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

const WIDTH = "mx-auto w-full max-w-[1160px] px-4 sm:px-6 lg:px-10";

/**
 * A guided flow's page: the mark, where the owner is (Arc's stepper; it folds into markers on a phone), the screen,
 * and a quiet footer. `current` is the step in progress (`steps.length` once all are done); null hides the stepper
 * (screens outside the flow).
 */
export function FlowFrame(props: {
  steps: readonly string[];
  current: number | null;
  stepsLabel: string;
  /** Named once `current` is past the last step. */
  completeLabel?: string;
  skipLabel: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {props.skipLabel}
      </a>
      <header className={cn(WIDTH, "flex flex-wrap items-center justify-between gap-x-8 gap-y-5 pt-5")}>
        <span className="flex min-h-11 items-center gap-2.5">
          <BrandMark />
          <span translate="no" className="font-heading text-xl font-bold tracking-[-0.01em]">
            Deparked
          </span>
        </span>
        {props.current === null ? null : (
          <div className="w-full lg:w-[32rem]">
            <Stepper
              steps={props.steps.map((step) => ({ id: step, label: step }))}
              current={props.current}
              label={props.stepsLabel}
              {...(props.completeLabel === undefined ? {} : { completeLabel: props.completeLabel })}
            />
          </div>
        )}
      </header>
      <main id="main" className={cn(WIDTH, "flex-1 pt-10 pb-16 sm:pt-14")}>
        {props.children}
      </main>
      <footer className={WIDTH}>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t py-4 text-xs text-muted-foreground">
          {props.footer}
        </div>
      </footer>
    </div>
  );
}

/**
 * A screen's question: one big line, at most two short lines under it. The heading takes focus when the screen
 * appears, so a screen reader announces where the owner is.
 */
export function FlowTitle(props: {
  eyebrow?: ReactNode;
  title: string;
  children?: ReactNode;
  size?: "lg" | "md";
  /** False when a field on the screen takes focus itself. */
  focus?: boolean;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const focus = props.focus !== false;
  useEffect(() => {
    if (focus) ref.current?.focus({ preventScroll: false });
  }, [focus]);
  return (
    <div className="flex flex-col gap-4">
      {props.eyebrow === undefined ? null : (
        <p className="text-sm font-medium text-muted-foreground [overflow-wrap:anywhere]">{props.eyebrow}</p>
      )}
      <h1
        ref={ref}
        tabIndex={-1}
        // The size comes before the leading: tailwind-merge drops a leading that a font size follows.
        className={cn(
          "font-heading font-bold tracking-[-0.02em] text-balance outline-none [overflow-wrap:anywhere]",
          props.size === "md" ? "text-[clamp(2rem,1.5rem+2vw,3rem)]" : "text-[clamp(2.375rem,1.7rem+2.8vw,3.5rem)]",
          "leading-[1.04]",
        )}
      >
        {props.title}
      </h1>
      {props.children === undefined ? null : (
        <div className="max-w-[46ch] text-[17px] leading-relaxed text-pretty text-muted-foreground [overflow-wrap:anywhere]">
          {props.children}
        </div>
      )}
    </div>
  );
}

/** "How this works", "Why": the detail a screen keeps out of the way. A native disclosure, so it works without script. */
export function Disclosure(props: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={cn("group", props.className)}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full text-sm font-semibold underline-offset-4 outline-none select-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        {props.summary}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="mt-1 mb-2 flex max-w-[62ch] flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
        {props.children}
      </div>
    </details>
  );
}

/** A page in a small browser window: two dots, the address with its padlock, the page under it. Decorative chrome. */
export function BrowserWindow(props: { address: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-[26px] bg-card p-2.5 shadow-float", props.className)}>
      <div aria-hidden="true" className="flex items-center gap-1.5 px-2 pt-1 pb-2.5">
        <span className="size-2.5 shrink-0 rounded-full bg-border" />
        <span className="size-2.5 shrink-0 rounded-full bg-border" />
        <span className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-background px-3 py-1.5 text-[12.5px] text-muted-foreground">
          <Lock className="size-3 shrink-0 text-positive" strokeWidth={2.6} />
          <span translate="no" className="truncate">
            {props.address}
          </span>
        </span>
      </div>
      <div className="overflow-hidden rounded-[18px]">{props.children}</div>
    </div>
  );
}

/** The green tag hung on a window that is live. Ink on green: readable in both themes. */
export function LiveTag(props: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl bg-positive px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap text-tangerine-foreground shadow-lift">
      <span aria-hidden="true" className="size-2 rounded-full bg-tangerine-foreground" />
      {props.children}
    </span>
  );
}

const SHAPES = [
  "-top-1 left-0 size-[26px] rounded-lg bg-tangerine rotate-[18deg]",
  "top-14 -right-1 size-[18px] rounded-full bg-[#5b7fb8]",
  "bottom-2 left-16 h-3 w-[34px] rounded-md bg-positive -rotate-12",
  "bottom-12 right-0 size-[22px] rounded-md bg-caution rotate-[30deg]",
] as const;

const SETTLE = { type: "spring", stiffness: 240, damping: 24 } as const;

/**
 * The window on a success screen, tilted in the shop window with a few paper shapes around it. `celebrate` plays a
 * short entrance once, when the screen appears: the only celebration in these flows, and none under reduced motion.
 */
export function Showcase(props: { children: ReactNode; tag?: ReactNode; celebrate?: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const enter = props.celebrate === true && reduced !== true;
  return (
    <div className={cn("relative mx-auto w-full max-w-[480px] px-5 py-7", props.className)}>
      {SHAPES.map((shape, index) => (
        <motion.span
          key={shape}
          aria-hidden="true"
          className={cn("absolute", shape)}
          initial={enter ? { opacity: 0, scale: 0.3 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...SETTLE, delay: 0.32 + index * 0.06 }}
        />
      ))}
      <motion.div
        className="relative"
        initial={enter ? { opacity: 0, y: 18, rotate: 0, scale: 0.97 } : false}
        animate={{ opacity: 1, y: 0, rotate: -2, scale: 1 }}
        transition={SETTLE}
      >
        {props.children}
      </motion.div>
      {props.tag === undefined ? null : (
        <motion.span
          className="absolute top-3 right-9"
          initial={enter ? { opacity: 0, y: -10, rotate: -4 } : false}
          animate={{ opacity: 1, y: 0, rotate: 5 }}
          transition={{ ...SETTLE, delay: 0.5 }}
        >
          {props.tag}
        </motion.span>
      )}
    </div>
  );
}

/** A dashed arrow from one drawing to the next. */
export function PathArrow(props: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 44 14"
      preserveAspectRatio="xMaxYMid meet"
      className={cn("h-3.5 shrink-0 stroke-input", props.className)}
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 7h36" strokeDasharray="1 6" />
      <path d="m36 2 6 5-6 5" />
    </svg>
  );
}

/**
 * A short story in drawings on a card: three or so stages left to right, each a decorative drawing over a caption,
 * a dashed arrow in the gap between them, and one reassuring line under a hairline. The captions carry the meaning.
 */
export function Journey(props: {
  label: string;
  stages: readonly { caption: string; picture: ReactNode }[];
  note: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-6 rounded-[32px] bg-card p-5 shadow-lift sm:p-8", props.className)}>
      <ol aria-label={props.label} className="flex items-start gap-[var(--gap)] [--gap:1.5rem] sm:[--gap:2.5rem]">
        {props.stages.map((stage, index) => (
          <li key={stage.caption} className="flex min-w-0 flex-1 flex-col items-center gap-2.5">
            <div aria-hidden="true" className="relative w-full">
              {stage.picture}
              {index === props.stages.length - 1 ? null : (
                <PathArrow className="absolute top-1/2 left-full w-[var(--gap)] -translate-y-1/2 px-1" />
              )}
            </div>
            <span className="text-center text-[13px] leading-snug font-semibold text-balance">{stage.caption}</span>
          </li>
        ))}
      </ol>
      <p className="flex items-start gap-3 border-t pt-5 text-sm text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-px size-5 shrink-0 text-positive" />
        <span>{props.note}</span>
      </p>
    </div>
  );
}
