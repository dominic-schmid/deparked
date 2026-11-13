import { FlowFrame } from "@deparked/ui/flow";
import { cn } from "@deparked/ui/lib/utils";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

// The installer's frame is the guided-flow frame the admin's first run uses too (`@deparked/ui/flow`).

export const STAGES = ["Connect", "Review", "Install", "Done"] as const;
export type Stage = (typeof STAGES)[number];

export function Shell(props: { stage: Stage | null; children: ReactNode }) {
  return (
    <FlowFrame
      steps={STAGES}
      // Done is the end of the flow, not a step in progress: every marker is ticked.
      current={props.stage === null ? null : props.stage === "Done" ? STAGES.length : STAGES.indexOf(props.stage)}
      stepsLabel="Install progress"
      completeLabel="Installed"
      skipLabel="Skip to the installer"
      footer={
        <>
          <span>Deparked runs in your Cloudflare account. No server of ours is involved.</span>
          <a
            className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-foreground"
            href="https://github.com/dominic-schmid/deparked"
            rel="noreferrer"
            target="_blank"
          >
            Source on GitHub
          </a>
        </>
      }
    >
      {props.children}
    </FlowFrame>
  );
}

/** A numbered part of a long screen: "1 Create the token", "2 Paste it here". */
export function Section(props: { title: string; number?: number; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-5", props.className)}>
      <h2 className="flex items-center gap-3 text-xl font-bold tracking-[-0.01em]">
        {props.number === undefined ? null : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary font-sans text-sm text-primary-foreground tabular-nums">
            {props.number}
          </span>
        )}
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

export function Spinner(props: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn("spin size-4", props.className)} />;
}

export function Screen(props: { children: ReactNode }) {
  return <div className="screen-in">{props.children}</div>;
}
