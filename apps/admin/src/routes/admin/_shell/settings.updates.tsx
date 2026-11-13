import type { ReleaseChange, ReleasePin, ReleaseStatus, SetupEffect } from "@deparked/hosting";
import { Alert } from "@deparked/ui/arc/alert";
import { Button } from "@deparked/ui/button";
import { Disclosure } from "@deparked/ui/flow";
import { cn } from "@deparked/ui/lib/utils";
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpCircle, Check, ExternalLink, FileUp, Info, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../../../components/confirm-dialog";
import { runPublish } from "../../../components/editor/publish-loop";
import { IconRows, SectionPart, SettingsSection } from "../../../components/settings-ui";
import { CredentialsRejected, type RowStatus, StatusIcon } from "../../../components/setup-runner";
import { RelativeTime } from "../../../components/time";
import { type RunEvent, type RunOutcome, runChange, type Stage } from "../../../components/update-run";
import { startPublish, stepPublish } from "../../../server/publish/functions";
import {
  checkForUpdates,
  finishRelease,
  type getUpdates,
  previewUpdate,
  releaseStep,
  startRollback,
  startUpdate,
} from "../../../server/updates/functions";
import type { UpdatesView } from "../../../server/updates/updates";

const settingsRoute = getRouteApi("/admin/_shell/settings");

// The settings frame loads what this page shows (its list says whether an update is ready).
export const Route = createFileRoute("/admin/_shell/settings/updates")({
  head: () => ({ meta: [{ title: "Updates · Deparked" }] }),
  component: UpdatesPage,
});

/** Buttons that name a version: a long pre-release name wraps instead of running off a phone screen. */
const VERSION_BUTTON = "h-auto min-h-9 py-2 whitespace-normal text-left [overflow-wrap:anywhere]";

const DATABASE_NOTE =
  "Database changes only go forward: Deparked offers a rollback only while the earlier version can still run on your database. Your offers and settings stay either way.";

function Checksum({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <code className="rounded-lg bg-secondary px-2.5 py-1.5 font-mono text-xs [overflow-wrap:anywhere]">{value}</code>
    </div>
  );
}

function Problem(props: { message: string; credentialsRejected: boolean; title: string }) {
  if (props.credentialsRejected) return <CredentialsRejected message={props.message} />;
  return (
    <Alert tone="danger" title={props.title}>
      <span className="[overflow-wrap:anywhere]">{props.message}</span>
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
  rollback: ReleaseStatus["rollback"];
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
      step: (state) => step({ data: { state, expected: { kind: change.kind, pin: change.pin } } }),
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
  }, [
    change.kind,
    change.pin,
    finish,
    initialRows,
    mark,
    onEvent,
    publishStep,
    router,
    start,
    step,
    version,
    view.running,
  ]);

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
    <SectionPart title={`${verb} Deparked ${version}`} divided>
      {running || failed !== null || outcome?.status !== "done" ? (
        <p className="text-sm text-muted-foreground">
          {running
            ? "Keep this tab open until every step is done. Your pages stay online the whole time."
            : failed !== null
              ? "It stopped before the end. Every step is safe to repeat: Retry continues where it stopped."
              : "It did not finish. Continue it, or roll back."}
        </p>
      ) : null}
      <ol aria-label={`${verb} Deparked ${version}`} className="flex flex-col divide-y rounded-2xl bg-background">
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
        <Alert tone="success" title={`Deparked ${version} is installed`}>
          Every page was published again with it.
        </Alert>
      ) : null}
      {!running && outcome?.status !== "done" ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void go()}>{outcome === null ? "Continue" : "Retry"}</Button>
          {props.rollback?.possible === true ? (
            <Button className={VERSION_BUTTON} variant="outline" onClick={props.onRollback}>
              Roll back to {props.rollback.pin.version}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!running && failed !== null && props.rollback !== null && !props.rollback.possible ? (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{props.rollback.reason}</p>
      ) : null}
    </SectionPart>
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
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<{ message: string; credentialsRejected: boolean } | null>(null);
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
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const answer = await start({ data: { ...pin, confirm: true } });
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
    <SectionPart title={`Update available: Deparked ${latest.version}`} divided>
      <p className="text-sm text-muted-foreground">
        You have {props.installed}. Nothing changes until you confirm; Deparked never updates on its own.
      </p>
      <a
        href={latest.notesUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-1 rounded-sm text-sm font-semibold underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        What is new in {latest.version}
        <ExternalLink aria-hidden="true" className="size-3.5" />
        <span className="sr-only">(opens GitHub in a new tab)</span>
      </a>
      <Checksum label="Checksum of its release.json (SHA-256)" value={latest.sha256} />
      {review === null ? (
        <div>
          <Button onClick={() => void onReview()} aria-disabled={busy}>
            {busy ? "Checking the release…" : "Review the update"}
          </Button>
        </div>
      ) : review.ok ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 text-sm">
            <h4 className="font-semibold">What will change</h4>
            <IconRows
              label="What will change"
              rows={[
                ...review.steps.flatMap((step) =>
                  step.effects.map((effect) => ({
                    key: `${step.id}:${effect.what}`,
                    icon: FileUp,
                    tone: "neutral" as const,
                    text: effect.what,
                  })),
                ),
                {
                  key: "republish",
                  icon: ArrowUpCircle,
                  tone: "neutral" as const,
                  text: "every page is published again with the new designs",
                },
              ]}
            />
            <p className="text-muted-foreground">
              The admin is replaced while you use it. You stay logged in; the page reloads once the new version answers.
            </p>
          </div>
          {review.rollback.possible ? (
            <p className="text-sm text-muted-foreground">
              You can roll back to {props.installed} afterwards. {DATABASE_NOTE}
            </p>
          ) : (
            <Alert tone="warning" title="No way back">
              <span className="[overflow-wrap:anywhere]">{review.rollback.reason}</span>
            </Alert>
          )}
          {blocked ? null : (
            <div>
              <Button
                variant="accent"
                className={VERSION_BUTTON}
                onClick={() => setConfirming(true)}
                aria-disabled={busy}
              >
                {busy ? "Starting…" : `Install Deparked ${latest.version}`}
              </Button>
            </div>
          )}
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Install Deparked ${latest.version}?`}
            cancel="Not now"
            confirm={`Install ${latest.version}`}
            onConfirm={() => void onInstall()}
          >
            <p>
              Deparked downloads it from the Deparked repository on GitHub and checks every file against the checksum
              above. That catches a download that was corrupted or altered on its way. It cannot tell whether the
              repository itself was compromised: install updates you trust.
            </p>
            <p>
              {review.rollback.possible
                ? `You can roll back to ${props.installed} afterwards.`
                : "This update cannot be rolled back."}
            </p>
          </ConfirmDialog>
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
    </SectionPart>
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
    <ConfirmDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={`Roll back to Deparked ${props.target.version}?`}
      cancel={`Keep ${props.installed}`}
      confirm="Roll back"
      onConfirm={() => void onConfirm()}
    >
      <p>
        {props.target.version} is installed again in place of {props.installed}, and every page is published again with
        it. The database stays as it is: {props.installed} did not change it in a way {props.target.version} cannot run
        on. Offers and settings stay.
      </p>
      {error === null ? null : (
        <p role="alert" className="font-medium text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}

function UpdatesPage() {
  const fromFrame = settingsRoute.useLoaderData().updates;
  const loaded: Awaited<ReturnType<typeof getUpdates>> = fromFrame ?? {
    ok: false,
    credentialsRejected: false,
    message: "The admin did not answer. Try again.",
  };
  const check = useServerFn(checkForUpdates);
  const router = useRouter();
  const [checked, setChecked] = useState<typeof loaded | null>(null);
  const [checking, setChecking] = useState(false);
  const [started, setStarted] = useState<Pick<ReleaseChange, "kind" | "pin"> | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const answer = checked ?? loaded;
  // The change this page opened on stays on screen once it finishes, with its result.
  const [opened] = useState(() =>
    loaded.ok && loaded.value.status.change?.finished === false ? loaded.value.status.change : null,
  );

  if (!answer.ok) {
    return (
      <SettingsSection title="Updates">
        <Problem
          title="Updates cannot be checked"
          message={answer.message}
          credentialsRejected={answer.credentialsRejected}
        />
      </SettingsSection>
    );
  }
  const view = answer.value;
  const { status, latest } = view;
  const unfinished = status.change !== null && !status.change.finished ? status.change : null;
  const change = started ?? opened ?? unfinished;
  // After the reload that hands over to the new admin, it carries on by itself.
  const resume =
    unfinished !== null &&
    view.running === unfinished.pin.version &&
    status.installed?.version === unfinished.pin.version;

  // Fresh after every run: the page reloads its data when a change stops or ends.
  const { rollback } = status;

  async function onCheck() {
    setChecking(true);
    try {
      setChecked(await check());
      // The settings list says whether an update is ready: it reads what this check stored.
      await router.invalidate();
    } catch {
      setChecked({ ok: false, credentialsRejected: false, message: "The admin did not answer. Try again." });
    } finally {
      setChecking(false);
    }
  }

  const onStarted = (next: Pick<ReleaseChange, "kind" | "pin">) => setStarted(next);

  const newest = latest !== null && !view.available && change === null;
  return (
    <SettingsSection
      title="Updates"
      lead="Updates come from Deparked's releases on GitHub. Each one is checked against its checksum before anything is installed."
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3.5 rounded-2xl bg-background px-4 py-3.5">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full",
              newest ? "bg-positive/15 text-[color:var(--success)]" : "bg-secondary",
            )}
          >
            {newest ? <Check className="size-4" strokeWidth={2.8} /> : <Info className="size-4" strokeWidth={2.4} />}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">Installed</span>
            <p className="font-semibold [overflow-wrap:anywhere]">
              {status.installed === null
                ? "No release is installed: this admin runs from a development build."
                : `Deparked ${status.installed.version}`}
            </p>
            <p className="text-sm text-muted-foreground">
              {latest === null ? (
                "Not checked for updates yet."
              ) : (
                <>
                  Checked <RelativeTime time={latest.checkedAt} now={view.now} />.
                  {newest ? " You have the newest release." : null}
                </>
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void onCheck()} aria-disabled={checking}>
            {checking ? "Checking…" : "Check again"}
          </Button>
        </div>
        {status.installed?.sha256 == null ? null : (
          <Disclosure summary="Its checksum">
            <Checksum label="Checksum of its release.json (SHA-256)" value={status.installed.sha256} />
          </Disclosure>
        )}
        {view.checkError === null ? null : (
          <Problem title="Could not check for updates" message={view.checkError} credentialsRejected={false} />
        )}
      </div>

      {change !== null ? (
        <ChangeProgress
          key={`${change.kind}:${change.pin.version}`}
          view={view}
          change={change}
          autoStart={started !== null || resume}
          rollback={change.kind === "update" ? rollback : null}
          onRollback={() => setRollbackOpen(true)}
        />
      ) : view.available && latest !== null && status.installed !== null ? (
        <UpdateAvailable latest={latest} installed={status.installed.version} onStarted={onStarted} />
      ) : null}

      {rollback !== null && change === null ? (
        <SectionPart title="Roll back" divided>
          <p className="text-sm text-muted-foreground">
            Go back to Deparked {rollback.pin.version}, the version you had before the last update.
          </p>
          {rollback.possible ? (
            <>
              <p className="text-sm text-muted-foreground">{DATABASE_NOTE}</p>
              <div>
                <Button className={VERSION_BUTTON} variant="outline" onClick={() => setRollbackOpen(true)}>
                  <RotateCcw aria-hidden="true" />
                  Roll back to {rollback.pin.version}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm [overflow-wrap:anywhere]">{rollback.reason}</p>
          )}
        </SectionPart>
      ) : null}

      {rollback?.possible === true && status.installed !== null ? (
        <RollbackDialog
          open={rollbackOpen}
          onOpenChange={setRollbackOpen}
          target={rollback.pin}
          installed={status.installed.version}
          onStarted={onStarted}
        />
      ) : null}
    </SettingsSection>
  );
}
