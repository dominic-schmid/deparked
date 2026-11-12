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
import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { EditorPublishState, HistoryItem } from "../../server/editor/editor";
import { RelativeTime } from "../time";
import type { PublishOutcome } from "./publish-loop";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "invalid";

/** What the publish bar shows: nothing yet, a publish running, how the last one ended, or following another. */
export type PublishView =
  | { phase: "idle" }
  | { phase: "running"; text: string }
  | { phase: "following"; text: string }
  | { phase: "notice"; text: string }
  | { phase: "ended"; outcome: PublishOutcome; retry: (() => void) | null };

const SAVE_TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Draft saved",
  error: "Could not save",
  invalid: "Not saved: fix the marked fields",
};

export function SaveState(props: {
  status: SaveStatus;
  invalidCount: number;
  /** An error that belongs to no field (`form`, `version`): shown here instead of the plain state. */
  problem?: string | undefined;
  onRetry: () => void;
}) {
  const text = props.problem
    ? `Not saved: ${props.problem}`
    : props.status === "invalid"
      ? `Not saved: fix ${props.invalidCount === 1 ? "the marked field" : `the ${props.invalidCount} marked fields`}`
      : SAVE_TEXT[props.status];
  return (
    <p role="status" className="flex min-h-6 items-center gap-2 text-sm text-muted-foreground">
      <span
        className={
          props.problem || props.status === "error" || props.status === "invalid"
            ? "text-destructive [overflow-wrap:anywhere]"
            : undefined
        }
      >
        {text}
      </span>
      {props.status === "error" ? (
        <Button variant="link" size="sm" className="h-auto p-0" onClick={props.onRetry}>
          Try again
        </Button>
      ) : null}
    </p>
  );
}

const linkClass =
  "rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Outcome(props: { view: PublishView; host: string; onFollow: () => void }) {
  const { view } = props;
  if (view.phase === "idle") return null;
  if (view.phase === "notice") return <p className="text-sm">{view.text}</p>;
  if (view.phase === "running" || view.phase === "following") {
    return (
      <p className="flex items-start gap-2 text-sm">
        <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
        <span className="[overflow-wrap:anywhere]">{view.text}</span>
      </p>
    );
  }
  const { outcome } = view;
  if (outcome.status === "stopped") return null;
  if (outcome.status === "done") {
    return (
      <Alert>
        <AlertTitle>Published</AlertTitle>
        <AlertDescription>Visitors to {props.host} now see this version.</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>
        {outcome.reason === "busy"
          ? "Another publish is running"
          : outcome.reason === "stalled"
            ? "The publish stalled"
            : "Not published"}
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

export function PublishBar(props: {
  host: string;
  state: EditorPublishState;
  now: number;
  /** Null while the form is invalid: then nothing can be compared. */
  changes: string[] | null;
  hasLive: boolean;
  canPublish: boolean;
  view: PublishView;
  save: { status: SaveStatus; invalidCount: number; problem?: string | undefined; onRetry: () => void };
  onPublish: () => void;
  onFollow: () => void;
  onResetToLive: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const busy = props.view.phase === "running" || props.view.phase === "following";
  const { state } = props;
  const lastFailed = state.lastDeployment?.status === "failed" && props.view.phase === "idle";
  const otherRunning = state.holder !== null && props.view.phase === "idle";

  return (
    <Card className="gap-4 py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm">
              {state.publishedAt === null ? (
                "Not published yet."
              ) : (
                <>
                  Last published <RelativeTime time={state.publishedAt} now={props.now} />.
                </>
              )}{" "}
              {props.changes === null ? null : props.changes.length === 0 ? (
                <span className="text-muted-foreground">The draft matches the live page.</span>
              ) : props.hasLive ? (
                <span>
                  <span className="font-medium">Unpublished changes:</span>{" "}
                  <span className="text-muted-foreground">{props.changes.join(", ")}.</span>
                </span>
              ) : null}
            </p>
            <SaveState {...props.save} />
          </div>
          <div className="flex flex-wrap gap-2">
            {props.hasLive && props.changes !== null && props.changes.length > 0 ? (
              <Button variant="outline" disabled={busy} onClick={() => setConfirmReset(true)}>
                Reset to live
              </Button>
            ) : null}
            <Button
              onClick={props.onPublish}
              disabled={busy || !props.canPublish}
              aria-describedby={props.canPublish ? undefined : "publish-blocked"}
            >
              {busy ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </div>
        {props.canPublish || busy ? null : (
          <p id="publish-blocked" className="text-sm text-muted-foreground">
            {props.save.status === "invalid"
              ? "Fix the marked fields to publish."
              : props.changes?.length === 0
                ? "Nothing to publish: change something first."
                : "Waiting for the draft to save."}
          </p>
        )}
        <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
          <Outcome view={props.view} host={props.host} onFollow={props.onFollow} />
          {otherRunning ? (
            <p className="text-sm text-muted-foreground">
              A publish{state.holder?.host ? ` of ${state.holder.host}` : ""} is running right now. Yours starts once it
              has finished.
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
                The pages that are live are not the ones this admin describes, after a rollback or an interrupted
                publish. Publish again to bring them in line.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CardContent>
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the draft to the live page?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unpublished changes are replaced by what visitors see now. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my changes</AlertDialogCancel>
            <AlertDialogAction onClick={props.onResetToLive}>Reset draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function HistoryList(props: {
  host: string;
  items: HistoryItem[];
  now: number;
  disabled: boolean;
  onRevert: (item: HistoryItem) => void;
}) {
  const [pick, setPick] = useState<HistoryItem | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Published versions</h2>
        </CardTitle>
        <CardDescription>Revert puts an earlier version live again.</CardDescription>
      </CardHeader>
      <CardContent>
        {props.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing published yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {props.items.map((item, index) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">
                    {fillDomain(item.headline, props.host)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <RelativeTime time={item.publishedAt} now={props.now} /> · {item.variant}
                  </p>
                </div>
                {index === 0 ? (
                  <Badge variant="secondary">Latest</Badge>
                ) : (
                  <Button variant="outline" size="sm" disabled={props.disabled} onClick={() => setPick(item)}>
                    Revert
                    <span className="sr-only">
                      {" "}
                      to the version published {new Date(item.publishedAt).toUTCString()}
                    </span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <AlertDialog open={pick !== null} onOpenChange={(open) => (open ? null : setPick(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert to this version?</AlertDialogTitle>
            <AlertDialogDescription>
              It becomes the draft and is published right away. Your current draft, with any unpublished changes, is
              replaced.
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
              Revert and publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
