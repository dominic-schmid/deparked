import type { SetupEffect, SetupState } from "@deparked/hosting";
import { Alert, AlertDescription, AlertTitle } from "@deparked/ui/alert";
import { Button } from "@deparked/ui/button";
import { cn } from "@deparked/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Check, Circle, CircleAlert, Clock, LoaderCircle, Minus } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { SetupFailure } from "../server/domain-setup/functions";
import type { StepView } from "../server/domain-setup/steps";

export type StepRun = (state: SetupState) => Promise<{ ok: true; value: StepView } | SetupFailure>;

type RowStatus = "pending" | "running" | "waiting" | "done" | "skipped" | "failed" | "blocked";

type Row = { id: string; title: string; status: RowStatus; effects: SetupEffect[] };

type Problem = { kind: "failed" | "blocked"; message: string; credentialsRejected: boolean };

/** How long to wait before asking again while another change runs, and how often. */
const BUSY_WAIT_MS = 3000;
const BUSY_TRIES = 40;

const STATUS_WORDS: Record<RowStatus, string> = {
  pending: "Not started",
  running: "Running",
  waiting: "Waiting for another change to finish",
  done: "Done",
  skipped: "Already set, nothing to do",
  failed: "Failed",
  blocked: "Needs you",
};

function StatusIcon({ status }: { status: RowStatus }) {
  const className = "size-4 shrink-0";
  switch (status) {
    case "pending":
      return <Circle aria-hidden="true" className={cn(className, "text-muted-foreground/60")} />;
    case "running":
      return <LoaderCircle aria-hidden="true" className={cn(className, "animate-spin motion-reduce:animate-none")} />;
    case "waiting":
      return <Clock aria-hidden="true" className={cn(className, "text-amber-600 dark:text-amber-400")} />;
    case "done":
      return <Check aria-hidden="true" className={cn(className, "text-emerald-600 dark:text-emerald-400")} />;
    case "skipped":
      return <Minus aria-hidden="true" className={cn(className, "text-muted-foreground")} />;
    default:
      return <CircleAlert aria-hidden="true" className={cn(className, "text-destructive")} />;
  }
}

/** The "token rejected" message, with the way out. */
export function CredentialsRejected({ message }: { message?: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Cloudflare rejected the token</AlertTitle>
      <AlertDescription>
        <p>
          {message ??
            "The saved API token no longer works, or it lacks a permission. Nothing was changed by this step."}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link to="/admin/settings/cloudflare">Replace token in Settings</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a change one step per request, from the first step, and shows its progress. Every step is safe to repeat,
 * so Retry sends the same step again. Starts on mount.
 */
export function SetupRunner(props: {
  steps: readonly { id: string; title: string }[];
  run: StepRun;
  onFinished: () => void;
  /** Accessible name of the progress list. */
  label: string;
  /** Shown next to "Check again" when a step needs the owner: where they can act on it. */
  blockedAction?: ReactNode;
}) {
  const { run, onFinished } = props;
  const [rows, setRows] = useState<Row[]>(() =>
    props.steps.map((step) => ({ ...step, status: "pending", effects: [] })),
  );
  const [problem, setProblem] = useState<Problem | null>(null);
  const [running, setRunning] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const state = useRef<SetupState>({ next: 0 });
  const alive = useRef(true);
  const started = useRef(false);

  const mark = useCallback(
    (index: number, status: RowStatus, effects?: SetupEffect[]) => {
      setRows((current) =>
        current.map((row, at) =>
          at === index ? { ...row, status, ...(effects === undefined ? {} : { effects }) } : row,
        ),
      );
      const title = props.steps[index]?.title;
      if (title !== undefined && status !== "pending") setAnnouncement(`${title}: ${STATUS_WORDS[status]}`);
    },
    [props.steps],
  );

  const go = useCallback(async () => {
    setProblem(null);
    setRunning(true);
    let busyTries = 0;
    while (alive.current) {
      const index = state.current.next;
      mark(index, busyTries > 0 ? "waiting" : "running");
      let result: Awaited<ReturnType<StepRun>>;
      try {
        result = await run(state.current);
      } catch {
        result = {
          ok: false,
          credentialsRejected: false,
          message: "The admin did not answer. Nothing is lost: try again.",
        };
      }
      if (!alive.current) return;
      if (!result.ok) {
        mark(index, "failed");
        setProblem({ kind: "failed", message: result.message, credentialsRejected: result.credentialsRejected });
        break;
      }
      const view = result.value;
      if (view.outcome === "working") continue;
      if (view.outcome === "busy") {
        busyTries += 1;
        if (busyTries > BUSY_TRIES) {
          mark(index, "failed");
          setProblem({ kind: "failed", message: view.message, credentialsRejected: false });
          break;
        }
        mark(index, "waiting");
        await sleep(BUSY_WAIT_MS);
        continue;
      }
      busyTries = 0;
      if (view.outcome === "failed" || view.outcome === "blocked") {
        mark(index, view.outcome);
        setProblem({ kind: view.outcome, message: view.message, credentialsRejected: view.credentialsRejected });
        break;
      }
      if (view.outcome !== "finished") {
        mark(
          index,
          view.outcome === "ran" ? "done" : "skipped",
          view.effects.filter((e) => e.kind !== "reuse"),
        );
      }
      state.current = view.state;
      if (view.finished || view.outcome === "finished") {
        setAnnouncement("All steps are done.");
        onFinished();
        break;
      }
    }
    if (alive.current) setRunning(false);
  }, [mark, run, onFinished]);

  useEffect(() => {
    alive.current = true;
    if (!started.current) {
      started.current = true;
      void go();
    }
    return () => {
      alive.current = false;
    };
  }, [go]);

  return (
    <div className="flex flex-col gap-4">
      <ol aria-label={props.label} className="flex flex-col divide-y rounded-xl border">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex gap-3 px-4 py-3"
            aria-current={row.status === "running" ? "step" : undefined}
          >
            <span className="mt-0.5">
              <StatusIcon status={row.status} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", row.status === "pending" && "text-muted-foreground")}>
                {row.title}
                <span className="sr-only">: {STATUS_WORDS[row.status]}</span>
              </p>
              {row.status === "waiting" ? (
                <p className="text-sm text-muted-foreground">Another change is running. Trying again in a moment.</p>
              ) : null}
              {row.effects.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground">
                  {row.effects.map((effect) => (
                    <li key={effect.what} className="[overflow-wrap:anywhere]">
                      {effect.what}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {problem === null ? null : problem.credentialsRejected ? (
        <div className="flex flex-col gap-3">
          <CredentialsRejected />
          <div>
            <Button variant="outline" onClick={() => void go()} disabled={running}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <Alert variant={problem.kind === "failed" ? "destructive" : "default"}>
          <AlertTitle>{problem.kind === "failed" ? "This step failed" : "Deparked needs you here"}</AlertTitle>
          <AlertDescription>
            <p className="[overflow-wrap:anywhere]">{problem.message}</p>
            <p>Every step is safe to repeat: nothing is done twice.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void go()} disabled={running}>
                {problem.kind === "failed" ? "Retry" : "Check again"}
              </Button>
              {problem.kind === "blocked" ? props.blockedAction : null}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
