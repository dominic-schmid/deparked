import { cn } from "@deparked/ui/lib/utils";
import type { DisplayStatus } from "../server/domains";

const STATUS: Record<DisplayStatus, { label: string; dot: string }> = {
  live: { label: "Live", dot: "bg-positive" },
  email_pending: { label: "Email pending", dot: "bg-caution" },
  draft: { label: "Draft", dot: "bg-muted-foreground/50" },
  off: { label: "Off", dot: "border border-muted-foreground/60" },
  error: { label: "Error", dot: "bg-negative" },
};

export function statusLabel(status: DisplayStatus): string {
  return STATUS[status].label;
}

/** Decorative: always next to the host or the status label, which carry the meaning. */
export function StatusDot({ status, className }: { status: DisplayStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", STATUS[status].dot, className)}
    />
  );
}

export function StatusLabel({ status }: { status: DisplayStatus }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm">
      <StatusDot status={status} />
      {STATUS[status].label}
    </span>
  );
}
