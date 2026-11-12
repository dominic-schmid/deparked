import type { ReleaseChange, ReleasePin, SetupEffect } from "@deparked/hosting";
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
import { Button } from "@deparked/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { Checkbox } from "@deparked/ui/checkbox";
import { Label } from "@deparked/ui/label";
import { cn } from "@deparked/ui/lib/utils";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { runPublish } from "../../../components/editor/publish-loop";
import { PageError, PagePending } from "../../../components/page";
import { CredentialsRejected, type RowStatus, StatusIcon } from "../../../components/setup-runner";
import { RelativeTime } from "../../../components/time";
import { type RunEvent, type RunOutcome, runChange, type Stage } from "../../../components/update-run";
import { startPublish, stepPublish } from "../../../server/publish/functions";
import {
  checkForUpdates,
  finishRelease,
  getUpdates,
  previewUpdate,
  releaseStep,
  startRollback,
  startUpdate,
} from "../../../server/updates/functions";
import type { UpdatesView } from "../../../server/updates/updates";

export const Route = createFileRoute("/admin/_shell/settings/updates")({
  loader: () => getUpdates(),
  head: () => ({ meta: [{ title: "Updates · Deparked" }] }),
  component: UpdatesPage,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

/** Buttons that name a version: a long pre-release name wraps instead of running off a phone screen. */
const VERSION_BUTTON = "h-auto min-h-9 py-2 whitespace-normal text-left [overflow-wrap:anywhere]";

const DATABASE_NOTE =
  "Database changes only go forward. If you roll back later, the database stays as the newer version left it; Deparked's database changes only add, so the earlier version keeps working with it. Your offers and settings stay either way.";

function Checksum({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs [overflow-wrap:anywhere]">{value}</code>
    </div>
  );
}

function Problem(props: { message: string; credentialsRejected: boolean; title: string }) {
  if (props.credentialsRejected) return <CredentialsRejected message={props.message} />;
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>{props.title}</AlertTitle>
      <AlertDescription className="[overflow-wrap:anywhere]">{props.message}</AlertDescription>
    </Alert>
  );
}

type Row = { id: string; title: string; status: RowStatus; effects: SetupEffect[] };

const STAGES: { id: Stage; title: (version: string) => string }[] = [
  { id: "handover", title: (version) => `Wait for Deparked ${version} to answer` },
  { id: "republish", title: () => "Publish every page again" },
  { id: "finish", title: () => "Finish" },
];

const STATUS_WORDS: Record<RowStatus, string> = {
  pending: "Not started",
  running: "Running",
  waiting: "Waiting for another change to finish",
  done: "Done",
  skipped: "Already done",
  failed: "Failed",
  blocked: "Needs you",
};

async function health(): Promise<{ release: string | null } | null> {
  const response = await fetch("/api/health", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return null;
  const body = (await response.json()) as { ok?: unknown; release?: unknown };
  if (body.ok !== true) return null;
  return { release: typeof body.release === "string" ? body.release : null };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The steps of the running change, driven from this page. Every step is safe to repeat: Retry starts over. */
function ChangeProgress(props: {
  view: UpdatesView;
  change: Pick<ReleaseChange, "kind" | "pin">;
  autoStart: boolean;
  rollbackTo: ReleasePin | null;
  onRollback: () => void;
}) {
  const { view, change } = props;
  const router = useRouter();
  const step = useServerFn(releaseStep);
  const finish = useServerFn(finishRelease);
  const start = useServerFn(startPublish);
  const publishStep = useServerFn(stepPublish);
  const version = change.pin.version;
  const initialRows = useCallback(
    (): Row[] => [
      ...view.steps.map((entry) => ({ ...entry, status: "pending" as const, effects: [] })),
      ...STAGES.map((stage) => ({
        id: stage.id,
        title: stage.title(version),
        status: "pending" as const,
        effects: [],
      })),
    ],
    [view.steps, version],
  );
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const abort = useRef<AbortController | null>(null);

  const mark = useCallback((id: string, status: RowStatus, effects?: SetupEffect[]) => {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        setAnnouncement(`${row.title}: ${STATUS_WORDS[status]}`);
        return { ...row, status, ...(effects === undefined ? {} : { effects }) };
      }),
    );
  }, []);

  const onEvent = useCallback(
    (event: RunEvent) => {
      if (event.type === "step-start") {
        const id = view.steps[event.index]?.id;
        if (id !== undefined) mark(id, event.waiting ? "waiting" : "running");
      } else if (event.type === "step") {
        const { report } = event;
        if (report.step === null) return;
        const status: RowStatus =
          report.outcome === "ran"
            ? "done"
            : report.outcome === "already-done"
              ? "skipped"
              : report.outcome === "blocked"
                ? "blocked"
                : "failed";
        mark(
          report.step.id,
          status,
          report.effects.filter((effect) => effect.kind !== "reuse"),
        );
      } else {
        mark(event.stage, event.status);
      }
    },
    [mark, view.steps],
  );

  const go = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRows(initialRows());
    setOutcome(null);
    setRunning(true);
    const result = await runChange({
      target: version,
      running: view.running,
      step: (state) => step({ data: { state } }),
      health,
      republish: () =>
        runPublish({
          start: () => start({ data: { kind: "republish-all" } }),
          step: (deploymentId) => publishStep({ data: { deploymentId } }),
          onStep: () => {},
          signal: controller.signal,
        }),
      finish: () => finish(),
      onEvent,
      sleep,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    if (result.status === "reloading") {
      setAnnouncement(`Deparked ${version} answers. Loading it…`);
      window.location.reload();
      return;
    }
    if (result.status === "failed" && typeof result.at === "string") mark(result.at, "failed");
    setOutcome(result);
    setRunning(false);
    await router.invalidate();
  }, [finish, initialRows, mark, onEvent, publishStep, router, start, step, version, view.running]);

  const once = useRef(false);
  useEffect(() => {
    if (!props.autoStart || once.current) return;
    once.current = true;
    void go();
  }, [props.autoStart, go]);
  useEffect(() => () => abort.current?.abort(), []);

  const failed = outcome?.status === "failed" ? outcome : null;
  const verb = change.kind === "update" ? "Updating to" : "Rolling back to";
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>
            {verb} Deparked {version}
          </h2>
        </CardTitle>
        <CardDescription>
          {running
            ? "Keep this tab open until every step is done. Your pages stay online the whole time."
            : failed !== null
              ? "It stopped before the end. Every step is safe to repeat: Retry continues where it stopped."
              : outcome?.status === "done"
                ? null
                : "It did not finish. Continue it, or roll back."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ol aria-label={`${verb} Deparked ${version}`} className="flex flex-col divide-y rounded-xl border">
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
                {row.effects.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {row.effects.map((effect) => (
                      <li key={`${effect.kind}:${effect.what}`}>{effect.what}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        {failed === null ? null : (
          <Problem
            title={failed.unhealthy === true ? `Deparked ${version} does not answer` : "This step did not work"}
            message={failed.message}
            credentialsRejected={failed.credentialsRejected}
          />
        )}
        {outcome?.status === "done" ? (
          <Alert role="status">
            <AlertTitle>Deparked {version} is installed</AlertTitle>
            <AlertDescription>Every page was published again with it.</AlertDescription>
          </Alert>
        ) : null}
        {!running && outcome?.status !== "done" ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void go()}>{outcome === null ? "Continue" : "Retry"}</Button>
            {props.rollbackTo !== null ? (
              <Button className={VERSION_BUTTON} variant="outline" onClick={props.onRollback}>
                Roll back to {props.rollbackTo.version}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

type Preview = Extract<Awaited<ReturnType<typeof previewUpdate>>, { ok: true }>["value"];

function UpdateAvailable(props: {
  latest: NonNullable<UpdatesView["latest"]>;
  installed: string;
  onStarted: (change: Pick<ReleaseChange, "kind" | "pin">) => void;
}) {
  const { latest } = props;
  const preview = useServerFn(previewUpdate);
  const start = useServerFn(startUpdate);
  const [review, setReview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<{ message: string; credentialsRejected: boolean } | null>(null);
  const checkboxId = useId();
  const pin = { version: latest.version, sha256: latest.sha256 };

  async function onReview() {
    setBusy(true);
    setError(null);
    try {
      const answer = await preview({ data: pin });
      if (!answer.ok) setError(answer);
      else setReview(answer.value);
    } catch {
      setError({ message: "The admin did not answer. Try again.", credentialsRejected: false });
    } finally {
      setBusy(false);
    }
  }

  async function onInstall() {
    if (!checked) {
      setError({ message: "Tick the box once the checksum matches the release notes.", credentialsRejected: false });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const answer = await start({ data: pin });
      if (!answer.ok) setError(answer);
      else if (!answer.value.ok) setError({ message: answer.value.message, credentialsRejected: false });
      else props.onStarted(answer.value.change);
    } catch {
      setError({ message: "The admin did not answer. Try again.", credentialsRejected: false });
    } finally {
      setBusy(false);
    }
  }

  const blocked = review?.ok === true && review.steps.some((step) => step.status === "blocked");
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Update available: Deparked {latest.version}</h2>
        </CardTitle>
        <CardDescription>
          You have {props.installed}. Nothing changes until you confirm below; Deparked never updates on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <a
          href={latest.notesUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-sm font-medium underline underline-offset-4"
        >
          What is new in {latest.version}
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens GitHub in a new tab)</span>
        </a>
        <Checksum label="Checksum of its release.json (SHA-256)" value={latest.sha256} />
        {review === null ? (
          <div>
            <Button variant="outline" onClick={() => void onReview()} aria-disabled={busy}>
              {busy ? "Checking the release…" : "Review the update"}
            </Button>
          </div>
        ) : review.ok ? (
          <div className="flex flex-col gap-4">
            <div className="text-sm">
              <h3 className="font-medium">What will change</h3>
              <ul className="mt-1 list-disc pl-5 [overflow-wrap:anywhere]">
                {review.steps.flatMap((step) =>
                  step.effects.map((effect) => <li key={`${step.id}:${effect.what}`}>{effect.what}</li>),
                )}
                <li>every page is published again with the new designs</li>
              </ul>
              <p className="mt-2 text-muted-foreground">
                The admin is replaced while you use it. You stay logged in; the page reloads once the new version
                answers.
              </p>
              <p className="mt-2 text-muted-foreground">{DATABASE_NOTE}</p>
            </div>
            {blocked ? null : (
              <>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    onCheckedChange={(value) => setChecked(value === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor={checkboxId} className="text-sm leading-snug font-normal">
                    The checksum above is the one in the release notes on GitHub.
                  </Label>
                </div>
                <div>
                  <Button className={VERSION_BUTTON} onClick={() => void onInstall()} aria-disabled={busy}>
                    {busy ? "Starting…" : `Install Deparked ${latest.version}`}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <Problem title="This release cannot be installed" message={review.message} credentialsRejected={false} />
        )}
        {review?.ok === true && blocked ? (
          <Problem
            title="Not yet"
            message={
              review.steps.find((step) => step.status === "blocked")?.effects[0]?.what ?? "Something needs you first."
            }
            credentialsRejected={false}
          />
        ) : null}
        {error === null ? null : <Problem title="Not started" {...error} />}
      </CardContent>
    </Card>
  );
}

function RollbackDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ReleasePin;
  installed: string;
  onStarted: (change: Pick<ReleaseChange, "kind" | "pin">) => void;
}) {
  const start = useServerFn(startRollback);
  const [error, setError] = useState<string | null>(null);
  async function onConfirm() {
    setError(null);
    try {
      const answer = await start({ data: { confirm: true } });
      if (!answer.ok) setError(answer.message);
      else if (!answer.value.ok) setError(answer.value.message);
      else {
        props.onOpenChange(false);
        props.onStarted(answer.value.change);
      }
    } catch {
      setError("The admin did not answer. Try again.");
    }
  }
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Roll back to Deparked {props.target.version}?</AlertDialogTitle>
          <AlertDialogDescription>
            {props.target.version} is installed again in place of {props.installed}, and every page is published again
            with it. The database stays as {props.installed} left it: Deparked's database changes only add, so{" "}
            {props.target.version} keeps working with it. Offers and settings stay.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep {props.installed}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
          >
            Roll back
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function UpdatesPage() {
  const loaded = Route.useLoaderData();
  const check = useServerFn(checkForUpdates);
  const [checked, setChecked] = useState<typeof loaded | null>(null);
  const [checking, setChecking] = useState(false);
  const [started, setStarted] = useState<Pick<ReleaseChange, "kind" | "pin"> | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const answer = checked ?? loaded;

  if (!answer.ok) {
    return (
      <div className="max-w-2xl">
        <Problem
          title="Updates cannot be checked"
          message={answer.message}
          credentialsRejected={answer.credentialsRejected}
        />
      </div>
    );
  }
  const view = answer.value;
  const { status, latest } = view;
  const unfinished = status.change !== null && !status.change.finished ? status.change : null;
  const change = started ?? unfinished;
  // After the reload that hands over to the new admin, it carries on by itself.
  const resume =
    unfinished !== null &&
    view.running === unfinished.pin.version &&
    status.installed?.version === unfinished.pin.version;

  // An update started on this page made the installed release the rollback target; the loaded view predates it.
  const installedPin =
    status.installed?.sha256 == null ? null : { version: status.installed.version, sha256: status.installed.sha256 };
  const rollbackTo = started?.kind === "update" ? installedPin : status.rollbackTo;

  async function onCheck() {
    setChecking(true);
    try {
      setChecked(await check());
    } catch {
      setChecked({ ok: false, credentialsRejected: false, message: "The admin did not answer. Try again." });
    } finally {
      setChecking(false);
    }
  }

  const onStarted = (next: Pick<ReleaseChange, "kind" | "pin">) => setStarted(next);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Installed release</h2>
          </CardTitle>
          <CardDescription>
            Updates come from Deparked's releases on GitHub. Each one is checked against its checksum before anything is
            installed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">
            {status.installed === null ? (
              "No release is installed: this admin runs from a development build."
            ) : (
              <>
                Deparked <span className="font-medium">{status.installed.version}</span>
              </>
            )}
          </p>
          {status.installed?.sha256 == null ? null : (
            <Checksum label="Checksum of its release.json (SHA-256)" value={status.installed.sha256} />
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            {latest === null ? (
              <span>Not checked for updates yet.</span>
            ) : (
              <span>
                Checked <RelativeTime time={latest.checkedAt} now={view.now} />.
                {view.available || change !== null ? null : " You have the newest release."}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => void onCheck()} aria-disabled={checking}>
              {checking ? "Checking…" : "Check again"}
            </Button>
          </div>
          {view.checkError === null ? null : (
            <Problem title="Could not check for updates" message={view.checkError} credentialsRejected={false} />
          )}
        </CardContent>
      </Card>

      {change !== null ? (
        <ChangeProgress
          key={`${change.kind}:${change.pin.version}`}
          view={view}
          change={change}
          autoStart={started !== null || resume}
          rollbackTo={change.kind === "update" ? rollbackTo : null}
          onRollback={() => setRollbackOpen(true)}
        />
      ) : view.available && latest !== null && status.installed !== null ? (
        <UpdateAvailable latest={latest} installed={status.installed.version} onStarted={onStarted} />
      ) : null}

      {status.rollbackTo !== null && change === null ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Roll back</h2>
            </CardTitle>
            <CardDescription>
              Go back to Deparked {status.rollbackTo.version}, the version you had before the last update.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{DATABASE_NOTE}</p>
            <div>
              <Button className={VERSION_BUTTON} variant="outline" onClick={() => setRollbackOpen(true)}>
                Roll back to {status.rollbackTo.version}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {rollbackTo !== null && status.installed !== null ? (
        <RollbackDialog
          open={rollbackOpen}
          onOpenChange={setRollbackOpen}
          target={rollbackTo}
          installed={status.installed.version}
          onStarted={onStarted}
        />
      ) : null}
    </div>
  );
}
