import type { SetupEffect } from "@deparked/hosting";
import { cn } from "@deparked/ui/lib/utils";
import { Check, type LucideIcon, Minus, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { type ReactNode, useId } from "react";

// The pieces the settings screens share: a section surface with its question, and lists drawn as icon rows.

export const TEXT_LINK =
  "rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** One settings section: a white surface, its name, one line, then what it holds. */
export function SettingsSection(props: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  /** `danger` marks the surface that holds an action which cannot be undone. */
  tone?: "danger";
  className?: string;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex min-w-0 flex-col gap-6 rounded-[28px] bg-card p-5 shadow-lift sm:p-7",
        props.tone === "danger" && "ring-1 ring-destructive/25",
        props.className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <h2
          id={titleId}
          className="font-heading text-[clamp(1.5rem,1.3rem+0.8vw,1.75rem)] leading-tight font-bold tracking-[-0.01em] text-balance [overflow-wrap:anywhere]"
        >
          {props.title}
        </h2>
        {props.lead === undefined ? null : (
          <div className="max-w-[62ch] text-pretty text-muted-foreground [overflow-wrap:anywhere]">{props.lead}</div>
        )}
      </div>
      {props.children}
    </section>
  );
}

/** A heading inside a section, under a hairline when it starts a new part. */
export function SectionPart(props: { title: string; children: ReactNode; divided?: boolean; className?: string }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn("flex flex-col gap-3", props.divided && "border-t pt-6", props.className)}
    >
      <h3 id={titleId} className="font-semibold">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

export type IconRow = { key: string; icon: LucideIcon; tone: "danger" | "positive" | "neutral"; text: ReactNode };

const TONE: Record<IconRow["tone"], string> = {
  danger: "bg-destructive/10 text-destructive",
  positive: "bg-positive/15 text-[color:var(--success)]",
  neutral: "bg-secondary text-foreground",
};

/** A short list drawn as rows with an icon each. The icon is decoration: the text says it all. */
export function IconRows(props: { label: string; rows: readonly IconRow[]; className?: string }) {
  return (
    <ul aria-label={props.label} className={cn("flex flex-col gap-2", props.className)}>
      {props.rows.map((row) => (
        <li key={row.key} className="flex items-start gap-3 text-sm">
          <span
            aria-hidden="true"
            className={cn("grid size-7 shrink-0 place-items-center rounded-full", TONE[row.tone])}
          >
            <row.icon className="size-3.5" strokeWidth={2.4} />
          </span>
          <span className="min-w-0 pt-1 [overflow-wrap:anywhere] first-letter:uppercase">{row.text}</span>
        </li>
      ))}
    </ul>
  );
}

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const EFFECT: Record<SetupEffect["kind"], { icon: LucideIcon; verb: string; tone: IconRow["tone"] }> = {
  create: { icon: Plus, verb: "Adds", tone: "neutral" },
  change: { icon: Pencil, verb: "Changes", tone: "neutral" },
  remove: { icon: Trash2, verb: "Removes", tone: "danger" },
  restore: { icon: RotateCcw, verb: "", tone: "neutral" },
  reuse: { icon: Minus, verb: "Leaves", tone: "neutral" },
};

/** What a change undoes in Cloudflare, one row per effect, in the words the step reports. */
export function effectRows(effects: readonly SetupEffect[], verbs: boolean): IconRow[] {
  return effects.map((effect) => {
    const look = EFFECT[effect.kind];
    return {
      key: `${effect.kind}:${effect.what}`,
      icon: look.icon,
      tone: look.tone,
      text: verbs && look.verb !== "" ? `${look.verb} ${effect.what}` : capitalize(effect.what),
    };
  });
}

/** What stays, one row each. */
export function keepRows(keeps: readonly string[], capitalized = false): IconRow[] {
  return keeps.map((keep) => ({
    key: keep,
    icon: Check,
    tone: "positive",
    text: capitalized ? capitalize(keep) : keep,
  }));
}
