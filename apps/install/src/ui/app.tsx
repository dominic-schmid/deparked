import { Alert, AlertDescription, AlertTitle } from "@deparked/ui/alert";
import { Button } from "@deparked/ui/button";
import { Input } from "@deparked/ui/input";
import { Label } from "@deparked/ui/label";
import { cn } from "@deparked/ui/lib/utils";
import { RadioGroup, RadioGroupItem } from "@deparked/ui/radio-group";
import { ArrowRight, Check, CircleAlert, Copy, ExternalLink, Eye, EyeOff, RotateCw, ShieldAlert } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import type { Account, ApiError, CheckResponse, PlanStep, Status, StepReport } from "../api";
import { checkToken, finishInstall, getStatus, rollbackStep, runStep } from "./client";
import { Screen, ScreenTitle, Section, Shell, Spinner, type Stage } from "./parts";
import { TokenDiagram, TokenPagePictures } from "./pictures";
import { TOKEN_PERMISSIONS, tokenTemplateUrl } from "./token-link";

type Ready = Extract<CheckResponse, { status: "ready" }>;

type View =
  | { name: "loading" }
  | { name: "unreachable" }
  | { name: "connect"; status: Status }
  | { name: "pick"; status: Status; token: string; accounts: Account[] }
  | { name: "review"; status: Status; token: string; ready: Ready }
  | { name: "installing"; status: Status; token: string; ready: Ready }
  | { name: "done"; setupUrl: string; adminUrl: string; recovered: boolean }
  | { name: "installed"; status: Status };

const STAGE: Record<View["name"], Stage | null> = {
  loading: null,
  unreachable: null,
  connect: "Connect",
  pick: "Connect",
  review: "Review",
  installing: "Install",
  done: "Done",
  installed: null,
};

const TOKEN_URL = tokenTemplateUrl("Deparked");

export function App() {
  const [view, setView] = useState<View>({ name: "loading" });

  const load = useCallback(async () => {
    const status = await getStatus();
    if (status === null) setView({ name: "unreachable" });
    else setView(status.phase === "installed" ? { name: "installed", status } : { name: "connect", status });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Shell stage={STAGE[view.name]}>
      <Screen key={view.name}>
        {view.name === "loading" ? (
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <Spinner /> Looking at this installer…
          </p>
        ) : null}
        {view.name === "unreachable" ? <Unreachable onRetry={load} /> : null}
        {view.name === "connect" ? (
          <Connect
            status={view.status}
            onReady={(token, result) =>
              result.status === "pick-account"
                ? setView({ name: "pick", status: view.status, token, accounts: result.accounts })
                : setView({ name: "review", status: view.status, token, ready: result })
            }
          />
        ) : null}
        {view.name === "pick" ? (
          <PickAccount
            accounts={view.accounts}
            token={view.token}
            onBack={() => setView({ name: "connect", status: view.status })}
            onReady={(ready) => setView({ name: "review", status: view.status, token: view.token, ready })}
          />
        ) : null}
        {view.name === "review" ? (
          <Review
            ready={view.ready}
            onBack={() => setView({ name: "connect", status: view.status })}
            onInstall={() => setView({ ...view, name: "installing" })}
          />
        ) : null}
        {view.name === "installing" ? (
          <Installing
            token={view.token}
            ready={view.ready}
            onDone={(setupUrl, adminUrl) => setView({ name: "done", setupUrl, adminUrl, recovered: false })}
          />
        ) : null}
        {view.name === "done" ? <Done setupUrl={view.setupUrl} recovered={view.recovered} /> : null}
        {view.name === "installed" ? (
          <Installed onLink={(setupUrl, adminUrl) => setView({ name: "done", setupUrl, adminUrl, recovered: true })} />
        ) : null}
      </Screen>
    </Shell>
  );
}

function Unreachable(props: { onRetry: () => void }) {
  return (
    <>
      <ScreenTitle title="The installer does not answer">
        <p>
          This page loaded, but the installer Worker behind it did not reply. Wait a minute (a fresh deploy can take
          that long), then try again.
        </p>
      </ScreenTitle>
      <Button onClick={props.onRetry}>
        <RotateCw aria-hidden /> Try again
      </Button>
    </>
  );
}

function ErrorNote(props: { error: ApiError | null; id?: string }) {
  if (props.error === null) return null;
  return (
    <p id={props.id} role="alert" className="mt-2.5 flex gap-2 text-sm text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{props.error.message}</span>
    </p>
  );
}

/** The paste field: hidden by default, never stored, no autocomplete. */
function TokenField(props: {
  value: string;
  onChange: (value: string) => void;
  error: ApiError | null;
  label?: string;
}) {
  const id = useId();
  const hint = useId();
  const errorId = useId();
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // A refused token: the cursor goes back to the field, so the next paste replaces it.
  useEffect(() => {
    if (props.error !== null) input.current?.focus();
  }, [props.error]);
  return (
    <div>
      <Label htmlFor={id} className="mb-2 text-sm font-medium">
        {props.label ?? "API token"}
      </Label>
      <div className="relative">
        <Input
          ref={input}
          id={id}
          name="token"
          type={visible ? "text" : "password"}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          aria-describedby={props.error === null ? hint : `${hint} ${errorId}`}
          aria-invalid={props.error === null ? undefined : true}
          className="h-11 pr-11 font-mono text-[15px] placeholder:font-sans sm:text-sm"
          placeholder="Paste the token you copied…"
          translate="no"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1 right-1"
          aria-label={visible ? "Hide the token" : "Show the token"}
          aria-pressed={visible}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      </div>
      <p id={hint} className="mt-2 text-[13px] text-muted-foreground">
        It stays in this tab's memory and goes only to your installer. Close the tab and it is gone.
      </p>
      <ErrorNote error={props.error} id={errorId} />
    </div>
  );
}

function formatDate(epoch: number): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(epoch));
}

function NoRelease() {
  return (
    <ScreenTitle title="Nothing to install yet">
      <p>
        This installer was built before the first Deparked release. Update your copy of the installer from the Deparked
        repository (sync your fork on GitHub, Cloudflare redeploys it), then open this page again.
      </p>
    </ScreenTitle>
  );
}

function Connect(props: {
  status: Status;
  onReady: (token: string, result: Extract<CheckResponse, { ok: true }>) => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  if (props.status.pinnedRelease === null) return <NoRelease />;
  const resuming = props.status.phase === "in-progress";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (token.trim() === "") {
      setError({ ok: false, error: "invalid-token", message: "Paste the token first." });
      return;
    }
    setBusy(true);
    setError(null);
    const result = await checkToken({ token: token.trim() });
    setBusy(false);
    if (result.ok) props.onReady(token.trim(), result);
    else setError(result);
  }

  return (
    <>
      <ScreenTitle eyebrow={`Deparked ${props.status.pinnedRelease}`} title="Connect your Cloudflare account">
        <p>
          Deparked installs itself into the Cloudflare account you deployed this installer to: a Worker for your
          for-sale pages, an admin panel and its database. It needs one API token for that, which you create on
          Cloudflare's site and paste here.
        </p>
      </ScreenTitle>

      {resuming ? (
        <Alert role="note" className="mb-8">
          <RotateCw aria-hidden />
          <AlertTitle>An install is half done</AlertTitle>
          <AlertDescription>
            <p>
              Paste your token again: once it is checked you see where the install stopped, and it continues from there
              without repeating anything.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <Section title="Why a token">
        <TokenDiagram />
        <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
          Cloudflare only lets a Worker publish pages or change settings with a token. The token travels from this page
          to your installer, then into your account as a secret of the admin panel. Deparked has no server of its own,
          so nobody else ever sees it.
        </p>
      </Section>

      <Section title="Create the token" number={1}>
        <div className="flex flex-col gap-6">
          <div>
            <Button asChild size="lg" className="h-11 px-5">
              <a href={TOKEN_URL} target="_blank" rel="noreferrer">
                Open Cloudflare's token page <ExternalLink aria-hidden />
              </a>
            </Button>
            <p className="mt-2.5 text-[13px] text-muted-foreground">
              Opens in a new tab with the name and every permission filled in. Log in to the same account first.
            </p>
          </div>
          <TokenPagePictures />
          <Alert role="note">
            <ShieldAlert aria-hidden />
            <AlertTitle>What this token can do</AlertTitle>
            <AlertDescription>
              <p>
                It can change every Worker in this account, not just Deparked's: Cloudflare cannot narrow that
                permission to one Worker. Deparked keeps it only as a secret of its admin panel. Delete it on
                Cloudflare's token page whenever you like; your pages keep working, publishing stops until you add a new
                one.
              </p>
              <details className="group mt-2">
                <summary className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline">
                  All {TOKEN_PERMISSIONS.length} permissions and why
                </summary>
                <ul className="mt-2 grid gap-1.5">
                  {TOKEN_PERMISSIONS.map((permission) => (
                    <li key={permission.key} className="grid gap-x-3 sm:grid-cols-[13rem_1fr]">
                      <span className="font-medium text-foreground">
                        {permission.label} · {permission.type === "edit" ? "Edit" : "Read"}
                      </span>
                      <span>{permission.why}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </AlertDescription>
          </Alert>
        </div>
      </Section>

      <Section title="Paste it here" number={2} className="pb-0">
        <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
          <TokenField value={token} onChange={setToken} error={error} />
          <div>
            <Button type="submit" size="lg" className="h-11 px-5" disabled={busy}>
              {busy ? <Spinner /> : null}
              {busy ? "Checking the token…" : resuming ? "Check and continue" : "Check the token"}
            </Button>
          </div>
        </form>
      </Section>
    </>
  );
}

function PickAccount(props: {
  accounts: Account[];
  token: string;
  onBack: () => void;
  onReady: (ready: Ready) => void;
}) {
  const [choice, setChoice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const legend = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (choice === "") {
      setError({ ok: false, error: "bad-request", message: "Choose the account first." });
      return;
    }
    setBusy(true);
    setError(null);
    const result = await checkToken({ token: props.token, accountId: choice });
    setBusy(false);
    if (result.ok && result.status === "ready") props.onReady(result);
    else if (!result.ok) setError(result);
  }

  return (
    <>
      <ScreenTitle title="Which account is this?">
        <p>
          The token reaches {props.accounts.length} Cloudflare accounts. Pick the one you deployed the installer to;
          Deparked checks that it really is.
        </p>
      </ScreenTitle>
      <form onSubmit={submit} className="flex max-w-xl flex-col gap-5">
        <fieldset aria-labelledby={legend} className="min-w-0">
          <legend id={legend} className="sr-only">
            Cloudflare account
          </legend>
          <RadioGroup
            value={choice}
            onValueChange={setChoice}
            className={cn(
              "gap-2",
              // A long list scrolls in its own box, so the button stays in reach.
              props.accounts.length > 6 &&
                "max-h-[min(28rem,60dvh)] overflow-y-auto overscroll-contain rounded-xl border p-2",
            )}
          >
            {props.accounts.map((account) => (
              <Label
                key={account.id}
                className={cn(
                  "flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-accent/60 [&>button]:mt-0.5",
                  choice === account.id && "border-primary/40 bg-accent/60",
                )}
              >
                <RadioGroupItem value={account.id} />
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium">{account.name}</span>
                  <span translate="no" className="block truncate font-mono text-xs text-muted-foreground">
                    {account.id}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
        <ErrorNote error={error} />
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap [&>*]:w-full sm:[&>*]:w-auto">
          <Button type="submit" size="lg" className="h-11 px-5" disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? "Checking…" : "Use this account"}
          </Button>
          <Button type="button" variant="ghost" size="lg" className="h-11" onClick={props.onBack}>
            Use another token
          </Button>
        </div>
      </form>
    </>
  );
}

function StepPreview(props: { step: PlanStep }) {
  const { step } = props;
  return (
    <li className="flex gap-3 py-3.5">
      <span
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
          step.status === "done" && "border-primary bg-primary text-primary-foreground",
          step.status === "blocked" && "border-destructive text-destructive",
        )}
      >
        {step.status === "done" ? <Check aria-hidden className="size-3" strokeWidth={3} /> : null}
        {step.status === "blocked" ? <CircleAlert aria-hidden className="size-3.5" /> : null}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {step.title}
          {step.status === "done" ? <span className="font-normal text-muted-foreground"> · already done</span> : null}
        </p>
        {step.status === "blocked" ? (
          <p className="mt-1 text-sm text-destructive">{step.reason}</p>
        ) : (
          <ul className="mt-1 grid gap-0.5 text-[13px] text-muted-foreground">
            {step.effects.map((effect) => (
              <li key={effect.what} className="break-words">
                {effect.kind === "create" ? "Creates " : effect.kind === "change" ? "Updates " : ""}
                {effect.what}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function Review(props: { ready: Ready; onBack: () => void; onInstall: () => void }) {
  const { ready } = props;
  const blocked = ready.missing.length > 0 || ready.steps.some((step) => step.status === "blocked");
  return (
    <>
      <ScreenTitle
        eyebrow={`Account: ${ready.account.name}`}
        title={
          ready.missing.length > 0 ? "The token is missing permissions" : `Ready to install Deparked ${ready.release}`
        }
      >
        {ready.missing.length > 0 ? (
          <p>
            Cloudflare refused {ready.missing.length === 1 ? "one thing" : `${ready.missing.length} things`} Deparked
            needs. Create a new token with the button below (it asks for everything), then paste it.
          </p>
        ) : (
          <p>Nothing has changed in your account yet. This is what the install does, one step at a time.</p>
        )}
      </ScreenTitle>

      {ready.progress?.startedAt == null ? null : (
        <Alert role="note" className="mb-8">
          <RotateCw aria-hidden />
          <AlertTitle>Continuing an install</AlertTitle>
          <AlertDescription>
            <p>
              It started {formatDate(ready.progress.startedAt)}
              {ready.progress.stoppedAt === null ? "" : ` and stopped at “${ready.progress.stoppedAt}”`}. Finished steps
              show as already done.
            </p>
            {ready.progress.lastError === null ? null : (
              <p className="mt-1 break-words">Last problem: {ready.progress.lastError}</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {ready.missing.length > 0 ? (
        <div className="mb-8 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4 sm:p-5">
          <ul className="grid gap-2.5">
            {ready.missing.map((gap) => (
              <li key={gap.label} className="text-sm">
                <span className="font-semibold">{gap.label}</span>
                <span className="text-muted-foreground"> · {gap.why}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild>
              <a href={TOKEN_URL} target="_blank" rel="noreferrer">
                Create a complete token <ExternalLink aria-hidden />
              </a>
            </Button>
            <Button variant="outline" onClick={props.onBack}>
              Paste the new token
            </Button>
          </div>
        </div>
      ) : (
        <ol className="mb-6 divide-y border-y">
          {ready.steps.map((step) => (
            <StepPreview key={step.id} step={step} />
          ))}
        </ol>
      )}

      {ready.unchecked.length > 0 ? (
        <p className="mb-8 max-w-[62ch] text-[13px] text-muted-foreground">
          {ready.unchecked.map((gap) => gap.label).join(", ")} could not be checked yet: Cloudflare only answers for
          them on a domain. They matter once you add one, and the admin checks them then.
        </p>
      ) : null}

      {ready.missing.length > 0 ? null : (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap [&>*]:w-full sm:[&>*]:w-auto">
          <Button size="lg" className="h-11 px-5" disabled={blocked} onClick={props.onInstall}>
            {ready.nothingToDo ? "Finish" : "Install Deparked"} <ArrowRight aria-hidden />
          </Button>
          <Button variant="ghost" size="lg" className="h-11" onClick={props.onBack}>
            Use another token
          </Button>
        </div>
      )}
    </>
  );
}

type Row = { id: string; title: string; state: "waiting" | "running" | "done" | "failed"; detail: string[] };

function Installing(props: { token: string; ready: Ready; onDone: (setupUrl: string, adminUrl: string) => void }) {
  const [rows, setRows] = useState<Row[]>(() =>
    props.ready.steps.map((step) => ({
      id: step.id,
      title: step.title,
      state: step.status === "done" ? "done" : "waiting",
      detail: step.status === "done" ? ["already done"] : [],
    })),
  );
  const [problem, setProblem] = useState<{ title: string; detail: string } | null>(null);
  const [handing, setHanding] = useState(false);
  const [announce, setAnnounce] = useState("Starting the install.");
  const next = useRef(0);
  const running = useRef(false);
  const retryRef = useRef<HTMLButtonElement>(null);
  const { token, onDone } = props;
  const accountId = props.ready.account.id;

  const update = useCallback((id: string, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setProblem(null);
    for (let guard = 0; guard < 40; guard += 1) {
      const id = props.ready.steps[next.current]?.id;
      if (id === undefined) break;
      update(id, { state: "running" });
      const result = await runStep({ token, accountId, next: next.current });
      if (!result.ok) {
        update(id, { state: "failed" });
        setProblem({ title: "The install stopped", detail: result.message });
        setAnnounce(`Stopped: ${result.message}`);
        running.current = false;
        return;
      }
      const report: StepReport = result.report;
      if (report.outcome === "busy") {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      if (report.outcome === "failed" || report.outcome === "blocked") {
        update(id, { state: "failed" });
        const title = report.step?.title ?? "A step";
        setProblem(
          report.outcome === "blocked"
            ? { title: `“${title}” needs you first`, detail: report.message }
            : { title: `“${title}” did not finish`, detail: report.message },
        );
        setAnnounce(`${report.step?.title ?? "A step"} stopped: ${report.message}`);
        running.current = false;
        return;
      }
      update(id, {
        state: "done",
        detail: report.outcome === "already-done" ? ["already done"] : report.effects.map((effect) => effect.what),
      });
      setAnnounce(`${report.step?.title ?? "Step"}: done.`);
      next.current = report.next;
      if (report.finished) break;
    }
    setHanding(true);
    setAnnounce("Every step is done. Making your setup link.");
    const finished = await finishInstall({ token, accountId });
    running.current = false;
    if (finished.ok) onDone(finished.setupUrl, finished.adminUrl);
    else {
      setHanding(false);
      setProblem({ title: "The setup link could not be made", detail: finished.message });
      setAnnounce(`Stopped: ${finished.message}`);
    }
  }, [accountId, onDone, props.ready.steps, token, update]);

  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => {
    if (problem !== null) retryRef.current?.focus();
  }, [problem]);

  return (
    <>
      <ScreenTitle title="Installing Deparked">
        <p>
          Each step is one short request from this tab. If you close it, open the installer again and paste your token:
          it continues where it stopped.
        </p>
      </ScreenTitle>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <ol className="divide-y border-y">
        {rows.map((row, index) => (
          <li key={row.id} className="flex gap-3.5 py-4">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors duration-200",
                row.state === "done" && "border-primary bg-primary text-primary-foreground",
                row.state === "running" && "border-primary text-foreground",
                row.state === "failed" && "border-destructive bg-destructive/10 text-destructive",
                row.state === "waiting" && "text-muted-foreground",
              )}
            >
              {row.state === "done" ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : null}
              {row.state === "running" ? <Spinner className="size-3.5" /> : null}
              {row.state === "failed" ? <CircleAlert aria-hidden className="size-3.5" /> : null}
              {row.state === "waiting" ? index + 1 : null}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className={cn("text-sm font-medium", row.state === "waiting" && "text-muted-foreground")}>
                {row.title}
                <span className="sr-only">
                  {row.state === "done"
                    ? ", done"
                    : row.state === "running"
                      ? ", running"
                      : row.state === "failed"
                        ? ", stopped"
                        : ", waiting"}
                </span>
              </p>
              {row.detail.length > 0 ? (
                <ul className="mt-1 grid gap-0.5 text-[13px] text-muted-foreground">
                  {row.detail.map((line) => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {handing ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Making your one-time setup link…
        </p>
      ) : null}
      {problem === null ? null : (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4 sm:p-5" role="alert">
          <p className="flex gap-2 text-sm font-medium">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>{problem.title}</span>
          </p>
          <p className="mt-1.5 pl-6 text-sm break-words text-muted-foreground">{problem.detail}</p>
          <p className="mt-1.5 pl-6 text-[13px] text-muted-foreground">
            Retry is safe: every step checks what is already there and repeats nothing that worked.
          </p>
          <Button ref={retryRef} className="mt-4 ml-6" onClick={() => void run()}>
            <RotateCw aria-hidden /> Retry
          </Button>
        </div>
      )}
    </>
  );
}

function CopyButton(props: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="lg"
      className="h-11"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{copied ? "Copied" : "Copy the link"}</span>
    </Button>
  );
}

function Done(props: { setupUrl: string; recovered: boolean }) {
  return (
    <>
      <ScreenTitle
        eyebrow={props.recovered ? "Recovery" : "Installed"}
        title={props.recovered ? "Here is a new setup link" : "Deparked is installed"}
      >
        <p>
          {props.recovered
            ? "Open it to set a new password for your workspace. Earlier setup links stop working."
            : "One step is left, and it happens in your new admin panel: create the password for your workspace."}
        </p>
      </ScreenTitle>
      <div className="rounded-xl border bg-card p-5 sm:p-6">
        <p className="text-sm font-medium">Your one-time setup link</p>
        <p
          translate="no"
          className="mt-2 break-all rounded-md bg-muted px-3 py-2.5 font-mono text-[13px] leading-relaxed"
        >
          {props.setupUrl}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild size="lg" className="h-11 px-5">
            <a href={props.setupUrl}>
              Create your password <ArrowRight aria-hidden />
            </a>
          </Button>
          <CopyButton text={props.setupUrl} />
        </div>
        <p className="mt-4 text-[13px] text-muted-foreground">
          It works once, for 24 hours, and this page shows it only now. Lost it? Open this installer again and paste
          your token: you get a new one.
        </p>
      </div>
    </>
  );
}

/** The installer's own address `deparked-install.<account>.workers.dev` names the admin's. */
function adminUrlFromHere(): string | null {
  const labels = window.location.hostname.split(".");
  if (labels.length !== 4 || labels[2] !== "workers" || labels[3] !== "dev") return null;
  return `https://deparked-admin.${labels[1]}.workers.dev/admin`;
}

type Action = "link" | "rollback";

/** Rolls the hub back one step per request, as the admin's own Roll back does. */
async function rollBack(input: { token: string; accountId: string }, onStep: (report: StepReport) => void) {
  let next = 0;
  for (let count = 0; count < 20; count += 1) {
    const answer = await rollbackStep({ ...input, next });
    if (!answer.ok) return answer;
    onStep(answer.report);
    const { outcome } = answer.report;
    if (outcome === "failed" || outcome === "blocked" || outcome === "busy") {
      return { ok: false as const, error: "cloudflare" as const, message: answer.report.message };
    }
    if (answer.report.finished || outcome === "finished") return { ok: true as const };
    next = answer.report.next;
  }
  return { ok: false as const, error: "cloudflare" as const, message: "The rollback did not finish. Try again." };
}

function Installed(props: { onLink: (setupUrl: string, adminUrl: string) => void }) {
  const adminUrl = adminUrlFromHere();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [action, setAction] = useState<Action>("link");
  const [progress, setProgress] = useState("");
  const [rolledBack, setRolledBack] = useState(false);

  async function recover(chosen: Action, accountId?: string) {
    setAction(chosen);
    setBusy(chosen);
    setError(null);
    setRolledBack(false);
    const checked = await checkToken(
      accountId === undefined ? { token: token.trim() } : { token: token.trim(), accountId },
    );
    if (!checked.ok) {
      setBusy(null);
      setError(checked);
      return;
    }
    if (checked.status === "pick-account") {
      setBusy(null);
      setAccounts(checked.accounts);
      return;
    }
    if (chosen === "rollback") {
      const result = await rollBack({ token: token.trim(), accountId: checked.account.id }, (report) => {
        if (report.step !== null) setProgress(`${report.step.title}: done`);
      });
      setBusy(null);
      setProgress("");
      if (result.ok) setRolledBack(true);
      else setError(result);
      return;
    }
    const finished = await finishInstall({ token: token.trim(), accountId: checked.account.id });
    setBusy(null);
    if (finished.ok) props.onLink(finished.setupUrl, finished.adminUrl);
    else setError(finished);
  }

  return (
    <>
      <ScreenTitle title="Deparked is installed">
        <p>Your admin panel runs as its own Worker. This installer only helps you back in if you lose access.</p>
      </ScreenTitle>
      {adminUrl === null ? null : (
        <Button asChild size="lg" className="mb-10 h-11 px-5">
          <a href={adminUrl}>
            Open the admin <ArrowRight aria-hidden />
          </a>
        </Button>
      )}
      <Section title="Lost your password or the setup link?" className="pb-0">
        <p className="mb-5 max-w-[62ch] text-sm text-muted-foreground">
          Paste a token for this account (the one you installed with, or a new one from{" "}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href={TOKEN_URL}
            target="_blank"
            rel="noreferrer"
          >
            Cloudflare's token page
          </a>
          ). The installer checks it really is your account, then gives you a new one-time setup link.
        </p>
        <form
          noValidate
          className="flex max-w-xl flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (token.trim() === "") setError({ ok: false, error: "invalid-token", message: "Paste the token first." });
            else void recover("link");
          }}
        >
          <TokenField value={token} onChange={setToken} error={error} />
          {accounts === null ? null : (
            <div className="grid gap-2">
              <p className="text-sm font-medium">The token reaches several accounts. Which one is this?</p>
              {accounts.map((account) => (
                <Button
                  key={account.id}
                  type="button"
                  variant="outline"
                  className="h-11 justify-start"
                  onClick={() => void recover(action, account.id)}
                >
                  {account.name}
                </Button>
              ))}
            </div>
          )}
          <div>
            <Button type="submit" size="lg" className="h-11 px-5" disabled={busy !== null}>
              {busy === "link" ? <Spinner /> : null}
              {busy === "link" ? "Checking…" : "Get a new setup link"}
            </Button>
          </div>
          <div className="mt-6 border-t pt-6">
            <p className="text-sm font-medium">The admin stopped working after an update?</p>
            <p className="mt-1 mb-4 max-w-[62ch] text-sm text-muted-foreground">
              With the same token, the installer puts back the version you had before the last update. Your pages stay
              online; the database keeps the newer version's changes, which the earlier version can work with. Then open
              the admin: it publishes every page again.
            </p>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 px-5"
              disabled={busy !== null}
              onClick={() => {
                if (token.trim() === "")
                  setError({ ok: false, error: "invalid-token", message: "Paste the token first." });
                else void recover("rollback");
              }}
            >
              {busy === "rollback" ? <Spinner /> : <RotateCw aria-hidden />}
              {busy === "rollback" ? "Rolling back…" : "Roll back the last update"}
            </Button>
            <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
              {busy === "rollback" ? progress : ""}
            </p>
            {rolledBack ? (
              <Alert className="mt-3" role="status">
                <AlertTitle>Rolled back</AlertTitle>
                <AlertDescription>
                  The earlier version is installed again. Open the admin to finish: it publishes every page again.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </form>
      </Section>
    </>
  );
}
