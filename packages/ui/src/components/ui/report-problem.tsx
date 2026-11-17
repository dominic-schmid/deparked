import { CopyButton } from "@deparked/ui/arc/copy-button";
import { Dialog, DialogContent } from "@deparked/ui/arc/dialog";
import { Button } from "@deparked/ui/components/ui/button";
import { Textarea } from "@deparked/ui/components/ui/textarea";
import {
  type Diagnostics,
  diagnostics,
  diagnosticsText,
  issueUrl,
  type ReportInput,
  reportText,
  SUMMARY_MAX,
  SUMMARY_MIN,
} from "@deparked/ui/lib/report";
import { cn } from "@deparked/ui/lib/utils";
import { ExternalLink } from "lucide-react";
import { useId, useRef, useState } from "react";

/**
 * "Report a problem": the user writes what happened, sees the anonymous diagnostics, and opens a prefilled GitHub
 * issue (or copies it all). Nothing is sent from here: GitHub shows the issue before it is posted.
 */
export function ReportDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; input: ReportInput }) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <ReportForm input={props.input} /> : null}
    </Dialog>
  );
}

function ReportForm(props: { input: ReportInput }) {
  // Read once when the dialog opens: the browser and the minute it was opened.
  const [value] = useState<Diagnostics>(() => diagnostics(props.input, navigator.userAgent, new Date()));
  const [summary, setSummary] = useState("");
  const [tried, setTried] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const summaryId = useId();
  const hintId = useId();
  const errorId = useId();
  const ready = summary.trim().length >= SUMMARY_MIN;
  const short = tried && !ready;

  const near = summary.length >= SUMMARY_MAX * 0.8;

  return (
    <DialogContent
      title="Report a problem"
      description="Opens a new GitHub issue from your account. You can still edit it there before posting."
      className="w-[min(calc(100vw-2rem),34rem)]"
      // The one thing to do here is write the summary.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        field.current?.focus();
      }}
      // A stray tap beside the dialog must not throw away what the owner wrote. Escape and Close still close it.
      onPointerDownOutside={(event) => {
        if (summary.trim() !== "") event.preventDefault();
      }}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor={summaryId} className="text-sm font-medium">
            What happened?
          </label>
          <Textarea
            ref={field}
            id={summaryId}
            name="summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            maxLength={SUMMARY_MAX}
            rows={4}
            required
            aria-invalid={short || undefined}
            aria-describedby={short ? `${hintId} ${errorId}` : hintId}
            placeholder="What you did, what you expected, what you saw instead."
            className="max-h-[40dvh]"
          />
          <p id={hintId} className="flex justify-between gap-3 text-[13px] text-muted-foreground">
            <span>The issue is public: leave out domain names, emails and buyer details.</span>
            {near ? (
              <span className="shrink-0 tabular-nums">
                {summary.length.toLocaleString("en")}/{SUMMARY_MAX.toLocaleString("en")}
              </span>
            ) : null}
          </p>
          {short ? (
            <p id={errorId} role="alert" className="text-[13px] text-destructive">
              Write a short summary first: at least {SUMMARY_MIN} characters.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Sent with it</p>
          <pre className="overflow-x-auto rounded-xl bg-secondary px-3 py-2.5 font-mono text-xs leading-relaxed">
            {diagnosticsText(value)}
          </pre>
          <p className="text-[13px] text-muted-foreground">
            A screenshot helps: add it on GitHub, with domain names and buyer details hidden.
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
          <CopyButton value={reportText(value, summary)} label="Copy" className="justify-center" />
          {ready ? (
            <Button asChild variant="accent">
              <a href={issueUrl(value, summary)} target="_blank" rel="noreferrer">
                Open GitHub issue <ExternalLink aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
          ) : (
            <Button
              variant="accent"
              aria-disabled="true"
              className="opacity-60"
              onClick={() => {
                setTried(true);
                field.current?.focus();
              }}
            >
              Open GitHub issue <ExternalLink aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </DialogContent>
  );
}

/** A quiet "Report this problem" link that opens the report dialog. For failures that are Deparked's, not the user's. */
export function ReportLink(props: { input: ReportInput; className?: string; children?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex min-h-11 cursor-pointer items-center self-start text-[13px] text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8",
          props.className,
        )}
      >
        {props.children ?? "Report this problem"}
      </button>
      <ReportDialog open={open} onOpenChange={setOpen} input={props.input} />
    </>
  );
}
