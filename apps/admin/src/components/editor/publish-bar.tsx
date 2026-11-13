import { fillDomain } from "@deparked/config";
import { Alert, AlertDescription, AlertTitle } from "@deparked/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@deparked/ui/alert-dialog";
import { ExpandableCard } from "@deparked/ui/arc/expandable-card";
import { Timeline, type TimelineEvent } from "@deparked/ui/arc/timeline";
import { Button } from "@deparked/ui/button";
import { cn } from "@deparked/ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@deparked/ui/popover";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, CircleAlert, Globe, History, Info, LoaderCircle } from "lucide-react";
import { type ReactNode, type Ref, useState } from "react";
import type { EditorPublishState, HistoryItem } from "../../server/editor/editor";
import { relativeTime } from "../format";
import { type ChangeValue, type FieldChange, variantLabel } from "./form";
import type { PublishOutcome } from "./publish-loop";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "invalid";

/** What the publish controls show: nothing yet, a publish running, how the last one ended, or following another. */
export type PublishView =
  | { phase: "idle" }
  | { phase: "running"; text: string }
  | { phase: "following"; text: string }
  | { phase: "notice"; text: string }
  | { phase: "ended"; outcome: PublishOutcome; retry: (() => void) | null };

export type SaveProps = {
  status: SaveStatus;
  invalidCount: number;
  /** An error that belongs to no field (`form`, `version`): shown instead of the plain state. */
  problem?: string | undefined;
  onRetry: () => void;
};

const linkClass =
  "rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function Value({ value, old }: { value: ChangeValue; old?: boolean }) {
  return (
    <span
      title={value.full}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5",
        old && "text-muted-foreground line-through decoration-muted-foreground/50",
      )}
    >
      {value.colors?.map((color) => (
        <span
          key={color}
          aria-hidden="true"
          className="size-3.5 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]"
          style={{ backgroundColor: color }}
        />
      ))}
      <span className="min-w-0 [overflow-wrap:anywhere]">{value.text}</span>
    </span>
  );
}

/** "Headline: “Old” → “New”", one line per field putting it live would change. */
function ChangeList({ changes }: { changes: FieldChange[] }) {
  return (
    <div className="text-sm">
      <p className="font-medium">Putting it live changes {plural(changes.length, "field", "fields")}:</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {changes.map((change) => (
          <li key={change.label} className="grid grid-cols-1 gap-x-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            <span className="text-muted-foreground">{change.label}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="sr-only">from</span>
              <Value value={change.from} old />
              <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="sr-only">to</span>
              <Value value={change.to} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The save and publish state in one short line, e.g. "Saved · 3 changes not live yet". */
function StateLine(props: {
  view: PublishView;
  save: SaveProps;
  hasLive: boolean;
  diff: FieldChange[] | null;
  busy: boolean;
  onResetToLive: () => void;
}) {
  const { view, save } = props;
  const [confirmReset, setConfirmReset] = useState(false);
  const icon = (kind: "ok" | "wait" | "problem") =>
    kind === "ok" ? (
      <Check aria-hidden="true" className="size-4 shrink-0 text-positive" strokeWidth={2.6} />
    ) : kind === "wait" ? (
      <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
    ) : (
      <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-destructive" />
    );

  let content: ReactNode;
  if (view.phase === "running" || view.phase === "following") {
    content = (
      <>
        {icon("wait")}
        <span className="[overflow-wrap:anywhere]">{view.text}</span>
      </>
    );
  } else if (save.problem || save.status === "invalid" || save.status === "error") {
    const text = save.problem
      ? `Not saved: ${save.problem}`
      : save.status === "invalid"
        ? `Not saved: fix ${save.invalidCount === 1 ? "the marked field" : `the ${save.invalidCount} marked fields`}`
        : "Could not save";
    content = (
      <>
        {icon("problem")}
        <span className="text-destructive [overflow-wrap:anywhere]">{text}</span>
        {save.status === "error" && !save.problem ? (
          <Button variant="link" size="sm" className="h-auto min-h-0 p-0" onClick={save.onRetry}>
            Try again
          </Button>
        ) : null}
      </>
    );
  } else if (save.status === "saving") {
    content = (
      <>
        {icon("wait")}
        <span>Saving…</span>
      </>
    );
  } else {
    const saved = save.status === "saved" ? "Saved · " : "";
    const changes = props.diff ?? [];
    content = !props.hasLive ? (
      <>
        {icon("ok")}
        <span>{saved}Not live yet</span>
      </>
    ) : changes.length === 0 ? (
      <>
        {icon("ok")}
        <span>Live · matches your draft</span>
      </>
    ) : (
      <>
        {icon("ok")}
        <span>{saved}</span>
        <Popover>
          <PopoverTrigger className="rounded-sm text-foreground underline decoration-dotted underline-offset-4 outline-none hover:decoration-solid focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {plural(changes.length, "change", "changes")} not live yet
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-[min(30rem,calc(100vw-2rem))] flex-col gap-4">
            <ChangeList changes={changes} />
            <div>
              <Button variant="outline" size="sm" disabled={props.busy} onClick={() => setConfirmReset(true)}>
                Reset to live
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </>
    );
  }

  return (
    <>
      <p role="status" className="flex min-h-6 min-w-0 items-center gap-2 text-sm text-muted-foreground">
        {content}
      </p>
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the draft to the live page?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes that are not live yet are replaced by what visitors see now. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my changes</AlertDialogCancel>
            <AlertDialogAction onClick={props.onResetToLive}>Reset draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The header's right side on the Page tab: the state in one line and the one main action. */
export function PublishActions(props: {
  state: EditorPublishState;
  /** The same changes, old to new; null while nothing is live or the form is invalid. */
  diff: FieldChange[] | null;
  hasLive: boolean;
  /** Null while the form is invalid: then nothing can be compared. */
  changes: string[] | null;
  canPublish: boolean;
  view: PublishView;
  save: SaveProps;
  onPublish: () => void;
  onResetToLive: () => void;
  publishRef?: Ref<HTMLButtonElement>;
}) {
  const busy = props.view.phase === "running" || props.view.phase === "following";
  return (
    <div
      // A grid item of the domain frame's header (see `d.$host.tsx`): the inline area wins over its children's span.
      style={{ gridArea: "actions" }}
      className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 md:justify-end"
    >
      <StateLine
        view={props.view}
        save={props.save}
        hasLive={props.hasLive}
        diff={props.diff}
        busy={busy}
        onResetToLive={props.onResetToLive}
      />
      <Button
        ref={props.publishRef}
        variant="accent"
        size="lg"
        onClick={props.onPublish}
        disabled={busy || !props.canPublish}
        aria-describedby={props.canPublish ? undefined : "publish-blocked"}
        className="max-sm:flex-1"
      >
        {busy ? "Putting it live…" : "Put it live"}
      </Button>
      {props.canPublish || busy ? null : (
        <span id="publish-blocked" className="sr-only">
          {props.save.status === "invalid"
            ? "Fix the marked fields first."
            : props.changes?.length === 0 && !props.state.outOfSync
              ? "Nothing to put live: the live page matches your draft."
              : "Waiting for the draft to save."}
        </span>
      )}
    </div>
  );
}

function Outcome(props: { view: PublishView; host: string; onFollow: () => void }) {
  const { view } = props;
  if (view.phase === "notice") {
    return (
      <p className="flex items-start gap-2 text-sm">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="[overflow-wrap:anywhere]">{view.text}</span>
      </p>
    );
  }
  if (view.phase !== "ended") return null;
  const { outcome } = view;
  if (outcome.status === "stopped") return null;
  if (outcome.status === "done") {
    return (
      <Alert>
        <Check aria-hidden="true" className="text-positive" />
        <AlertTitle>It's live</AlertTitle>
        <AlertDescription>
          <p className="[overflow-wrap:anywhere]">Visitors to {props.host} now see this version.</p>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>
        {outcome.reason === "busy"
          ? "Another publish is running"
          : outcome.reason === "stalled"
            ? "Putting it live stalled"
            : "Not live yet"}
      </AlertTitle>
      <AlertDescription>
        <p className="[overflow-wrap:anywhere]">{outcome.message}</p>
        {outcome.reason === "credentials-rejected" ? (
          <p>
            <Link to="/admin/settings/cloudflare" className={linkClass}>
              Replace token
            </Link>
            . The live page keeps working meanwhile.
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-2">
          {outcome.reason === "busy" ? (
            <Button variant="outline" size="sm" onClick={props.onFollow}>
              Wait until it has finished
            </Button>
          ) : null}
          {view.retry ? (
            <Button variant="outline" size="sm" onClick={view.retry}>
              Retry
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}

/** How the last publish ended and anything about the live pages worth knowing, under the header. */
export function PublishMessages(props: {
  host: string;
  state: EditorPublishState;
  view: PublishView;
  notice: string | null;
  onFollow: () => void;
}) {
  const { state } = props;
  const lastFailed = state.lastDeployment?.status === "failed" && props.view.phase === "idle";
  const otherRunning = state.holder !== null && props.view.phase === "idle";
  return (
    <div aria-live="polite" className="flex min-w-0 flex-col gap-3 empty:hidden">
      {props.notice ? (
        <Alert>
          <AlertDescription>{props.notice}</AlertDescription>
        </Alert>
      ) : null}
      <Outcome view={props.view} host={props.host} onFollow={props.onFollow} />
      {otherRunning ? (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          A publish{state.holder?.host ? ` of ${state.holder.host}` : ""} is running right now. Yours starts once it has
          finished.
        </p>
      ) : null}
      {lastFailed && state.lastDeployment?.error ? (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          The last publish did not finish: {state.lastDeployment.error}
        </p>
      ) : null}
      {state.outOfSync ? (
        <Alert>
          <AlertTitle>Visitors may see another version</AlertTitle>
          <AlertDescription>
            The pages that are live are not the ones this admin describes, after a rollback or an interrupted publish.
            Put it live again to bring them in line.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** Every published version, newest first; an earlier one can be put live again. */
export function VersionsCard(props: {
  host: string;
  items: HistoryItem[];
  now: number;
  disabled: boolean;
  onRevert: (item: HistoryItem) => void;
}) {
  const [pick, setPick] = useState<HistoryItem | null>(null);
  const [latest] = props.items;
  const events: TimelineEvent[] = props.items.map((item, index) => ({
    id: String(item.id),
    at: item.publishedAt,
    title: fillDomain(item.headline, props.host),
    meta: `${variantLabel(item.variant)} look${index === 0 ? " · live now" : ""}`,
    tone: index === 0 ? "success" : "neutral",
    icon: index === 0 ? <Globe aria-hidden="true" size={14} /> : <History aria-hidden="true" size={14} />,
    ...(index === 0
      ? {}
      : {
          detail: (
            <div className="flex flex-col items-start gap-2">
              <p>Puts this version live again and makes it your draft.</p>
              <Button variant="outline" size="sm" disabled={props.disabled} onClick={() => setPick(item)}>
                Put this version back
                <span className="sr-only"> (published {new Date(item.publishedAt).toUTCString()})</span>
              </Button>
            </div>
          ),
        }),
  }));
  return (
    <>
      <ExpandableCard
        title="Earlier versions"
        description={
          latest === undefined
            ? "Nothing live yet"
            : `Last put live ${relativeTime(latest.publishedAt, props.now)}${props.items.length > 1 ? ` · ${plural(props.items.length - 1, "earlier one", "earlier ones")}` : ""}`
        }
      >
        {latest === undefined ? (
          <p>Each time you put the page live, the version is kept here, so you can go back to it.</p>
        ) : (
          <Timeline events={events} now={props.now} label="Published versions" headingLevel={3} />
        )}
      </ExpandableCard>
      <AlertDialog open={pick !== null} onOpenChange={(open) => (open ? null : setPick(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Put this version back?</AlertDialogTitle>
            <AlertDialogDescription>
              It becomes the draft and goes live right away. Your current draft, with any changes that are not live yet,
              is replaced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pick) props.onRevert(pick);
                setPick(null);
              }}
            >
              Put it back live
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
