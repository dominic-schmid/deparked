import type {
  AccountDomain,
  DomainPreview,
  SetupConfirmation,
  SetupConfirmations,
  SetupEffect,
} from "@deparked/hosting";
import { Alert } from "@deparked/ui/arc/alert";
import { EmptyState } from "@deparked/ui/arc/empty-state";
import { ExpandableCard } from "@deparked/ui/arc/expandable-card";
import { Progress } from "@deparked/ui/arc/progress";
import { SearchField } from "@deparked/ui/arc/search-field";
import { Skeleton } from "@deparked/ui/arc/skeleton";
import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { Checkbox } from "@deparked/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@deparked/ui/field";
import { BrowserWindow, FlowTitle, LiveTag, Showcase } from "@deparked/ui/flow";
import { cn } from "@deparked/ui/lib/utils";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, ArrowUpRight, Globe, SearchX, Undo2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { attachStep, listAccountDomains, previewDomain, type SetupFailure } from "../server/domain-setup/functions";
import { getDomainDetail } from "../server/domains.functions";
import type { OfferMail } from "../server/notify-default";
import { OfferMailNotice } from "./offer-mail";
import { Split } from "./onboarding";
import { BeforeAfter, itemsSummary, SetupItemList, setupItems, type TodayState } from "./pictures";
import {
  CredentialsRejected,
  type RunnerRow,
  STATUS_WORDS,
  StatusIcon,
  type StepRun,
  useStepRunner,
} from "./setup-runner";
import { PageThumbnail } from "./thumbnail";

export const CLOUDFLARE_ADD_SITE_GUIDE = "https://developers.cloudflare.com/fundamentals/manage-domains/add-site/";

/** For buttons that name the domain: a long name wraps instead of leaving the screen. */
const WRAPS = "h-auto min-h-12 min-w-0 max-w-full shrink whitespace-normal py-2.5 [overflow-wrap:anywhere]";

const TEXT_LINK =
  "rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Failure({ failure, retry }: { failure: SetupFailure; retry: () => void }) {
  if (failure.credentialsRejected) return <CredentialsRejected message={failure.message} />;
  return (
    <Alert tone="danger" title="Cloudflare did not answer as expected">
      <span className="block [overflow-wrap:anywhere]">{failure.message}</span>
      <Button variant="outline" size="sm" className="mt-3" onClick={retry}>
        Try again
      </Button>
    </Alert>
  );
}

const unexpected: SetupFailure = {
  ok: false,
  credentialsRejected: false,
  message: "The admin did not answer. Nothing was changed.",
};

function NotOnCloudflare() {
  return (
    <p className="text-sm text-muted-foreground">
      Not listed? Add it to Cloudflare first with{" "}
      <a href={CLOUDFLARE_ADD_SITE_GUIDE} target="_blank" rel="noreferrer" className={TEXT_LINK}>
        Cloudflare's guide
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      , then come back.
    </p>
  );
}

/** A tiny shop window in front of each domain in the list. */
function WindowGlyph() {
  return (
    <span aria-hidden="true" className="grid h-9 w-11 shrink-0 place-items-center rounded-[10px] bg-secondary">
      <span className="flex w-7 flex-col gap-1">
        <span className="h-1 w-4 rounded-full bg-tangerine" />
        <span className="h-1 w-full rounded-full bg-input" />
        <span className="h-1 w-5 rounded-full bg-input" />
      </span>
    </span>
  );
}

/** Step 1: the domains of the Cloudflare account that Deparked does not manage yet. */
export function DomainPicker() {
  const navigate = useNavigate();
  const list = useServerFn(listAccountDomains);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [domains, setDomains] = useState<AccountDomain[] | null>(null);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [failure, setFailure] = useState<SetupFailure | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (page: number, append: boolean) => {
      setLoading(true);
      setFailure(null);
      try {
        const result = await list({ data: { search: query, page } });
        if (!result.ok) {
          setFailure(result);
          return;
        }
        setDomains((current) => (append ? [...(current ?? []), ...result.value.domains] : result.value.domains));
        setNextPage(result.value.nextPage);
      } catch {
        setFailure(unexpected);
      } finally {
        setLoading(false);
      }
    },
    [list, query],
  );

  useEffect(() => {
    void load(1, false);
  }, [load]);

  return (
    <section aria-label="Your Cloudflare domains" className="flex max-w-2xl flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
        }}
      >
        <SearchField
          label="Search your domains"
          name="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Type part of a name"
          value={search}
          onValueChange={setSearch}
        />
      </form>
      {failure === null ? null : <Failure failure={failure} retry={() => void load(1, false)} />}
      {domains === null && failure === null ? <Skeleton label="Loading your domains" lines={4} /> : null}
      {domains !== null && domains.length === 0 && !loading ? (
        query === "" ? (
          <EmptyState
            icon={<Globe width={24} height={24} strokeWidth={1.5} />}
            title="No domain left to add"
            description="Every domain in your Cloudflare account is already here, or the account has none yet."
            action={
              <Button asChild variant="outline">
                <a href={CLOUDFLARE_ADD_SITE_GUIDE} target="_blank" rel="noreferrer">
                  Add one to Cloudflare <ArrowUpRight aria-hidden />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<SearchX width={24} height={24} strokeWidth={1.5} />}
            title={`Nothing matches “${query}”`}
            description="No domain in your Cloudflare account with that in its name is waiting to be added."
            action={
              <Button variant="outline" onClick={() => setSearch("")}>
                Show all domains
              </Button>
            }
          />
        )
      ) : null}
      {domains !== null && domains.length > 0 ? (
        <ul aria-label="Domains you can add" aria-busy={loading} className="flex flex-col gap-2">
          {domains.map((domain) => (
            <li key={domain.id}>
              <button
                type="button"
                onClick={() => void navigate({ to: "/admin/add", search: { host: domain.name } })}
                className="group flex min-h-14 w-full items-center gap-3.5 rounded-2xl bg-card p-2.5 pr-4 text-left shadow-rest outline-none transition-[box-shadow,background-color] duration-150 hover:shadow-lift focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-hover motion-reduce:transition-none"
              >
                <WindowGlyph />
                <span
                  translate="no"
                  className="min-w-0 flex-1 font-heading text-lg font-bold tracking-[-0.01em] [overflow-wrap:anywhere]"
                >
                  {domain.name}
                </span>
                {domain.active ? (
                  <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground group-hover:text-foreground">
                    Choose <ArrowRight aria-hidden className="size-4" />
                  </span>
                ) : (
                  <Badge variant="outline" className="shrink-0">
                    Not active on Cloudflare yet
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {nextPage !== null ? (
        <div>
          <Button variant="outline" onClick={() => void load(nextPage, true)} disabled={loading}>
            {loading ? "Loading…" : "Show more domains"}
          </Button>
        </div>
      ) : null}
      <NotOnCloudflare />
    </section>
  );
}

function confirmationCopy(preview: DomainPreview, ask: SetupConfirmation): { label: string; detail: string } {
  const { host } = preview;
  switch (ask) {
    case "takeOverLiveSite":
      return {
        label: `Show the for-sale page instead of what ${host} shows today`,
        detail: `Visitors to ${host} get the for-sale page. Your site and its settings stay untouched in Cloudflare, and Turn off brings it back.`,
      };
    case "repointExistingRoutes":
      return {
        label: `Point ${preview.takenRoutes.join(" and ")} at Deparked`,
        detail:
          "Another Worker answers on this address today. Deparked writes down where it pointed, and Turn off points it back.",
      };
    case "replaceExistingMx":
      return {
        label: `Also move email for ${host} to Cloudflare (optional)`,
        detail: `Mail to addresses at ${host} would stop reaching ${preview.mailServers.join(", ") || "your mail provider"} until you turn Deparked off. Leave this off to keep your mail as it is; offer emails are then sent from another of your domains.`,
      };
  }
}

/** The confirmations the attach cannot go on without. The mail one is a choice, not a gate. */
const REQUIRED: readonly SetupConfirmation[] = ["takeOverLiveSite", "repointExistingRoutes"];

function EffectList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="font-sans text-sm font-semibold text-foreground">{title}</h3>
      <ul className="mt-1 list-disc pl-5 marker:text-muted-foreground/60">
        {items.map((item) => (
          <li key={item} className="[overflow-wrap:anywhere]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "a.com shows nothing today. More…" → ["a.com shows nothing today.", "More…"]. A dot inside a name is no end. */
function splitSummary(text: string): [string, string] {
  const match = /^(.+?[.!?])\s+(.+)$/s.exec(text.trim());
  return match === null ? [text, ""] : [match[1] ?? text, match[2] ?? ""];
}

function todayState(preview: DomainPreview): TodayState {
  if (preview.servesWebsite) return "website";
  return preview.takenRoutes.length > 0 ? "app" : "nothing";
}

/** "Turn off undoes it": the promise that makes saying yes safe, always in view next to the button. */
function UndoPromise() {
  return (
    <p className="flex items-start gap-3 text-sm text-muted-foreground">
      <Undo2 aria-hidden="true" className="mt-px size-[18px] shrink-0 text-[var(--success)]" />
      <span>Turning it off later undoes all of it. Deparked never touches what it did not create.</span>
    </p>
  );
}

function BackToList() {
  const navigate = useNavigate();
  return (
    <Button variant="ghost" className="min-h-12" onClick={() => void navigate({ to: "/admin/add", search: {} })}>
      <ArrowLeft aria-hidden="true" />
      Choose another domain
    </Button>
  );
}

/** Step 2: what the domain serves today and what Deparked would change, then the owner's explicit yes. */
function DomainReview(props: {
  host: string;
  onStart: (preview: DomainPreview, confirmations: SetupConfirmations) => void;
}) {
  const preview = useServerFn(previewDomain);
  const [result, setResult] = useState<DomainPreview | SetupFailure | null>(null);
  const [given, setGiven] = useState<SetupConfirmations>({});
  const hintId = useId();

  const load = useCallback(async () => {
    setResult(null);
    try {
      const answer = await preview({ data: { host: props.host, confirmations: {} } });
      setResult(answer.ok ? answer.value : answer);
    } catch {
      setResult(unexpected);
    }
  }, [preview, props.host]);

  useEffect(() => {
    void load();
  }, [load]);

  if (result === null) {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <FlowTitle eyebrow="Add a domain" title={props.host} size="md" focus={false}>
          <p>Looking at what it does today…</p>
        </FlowTitle>
        <Skeleton label={`Looking at ${props.host}`} lines={4} />
      </div>
    );
  }
  if ("ok" in result) {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <FlowTitle eyebrow="Add a domain" title={props.host} size="md" />
        <Failure failure={result} retry={() => void load()} />
        <div>
          <BackToList />
        </div>
      </div>
    );
  }

  const effects = (kind: SetupEffect["kind"]) =>
    result.steps.flatMap((step) => step.effects.filter((effect) => effect.kind === kind).map((effect) => effect.what));
  const missing = result.asks.filter((ask) => REQUIRED.includes(ask) && given[ask] !== true);
  const canStart = result.blockers.length === 0 && missing.length === 0;
  const items = setupItems(result.steps);
  const creates = effects("create");
  const changes = effects("change");
  // With the review shown, the summary's first sentence leads and the rest opens with the details.
  const willAsk = result.blockers.length === 0 && !result.nothingToDo;
  const [lead, rest] = splitSummary(result.summary);

  return (
    <Split pictureFirst picture={<BeforeAfter host={result.host} today={todayState(result)} />}>
      <FlowTitle eyebrow="Add a domain" title={result.host} size="md">
        <p>{willAsk ? lead : result.summary}</p>
      </FlowTitle>

      {result.blockers.length > 0 ? (
        <Alert tone="danger" title="Deparked cannot add this domain yet">
          <span className="flex flex-col gap-1">
            {result.blockers.map((blocker) => (
              <span key={blocker} className="block [overflow-wrap:anywhere]">
                {blocker}
              </span>
            ))}
          </span>
          {result.inAccount ? null : (
            <span className="mt-2 block">
              <NotOnCloudflare />
            </span>
          )}
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
            Check again
          </Button>
        </Alert>
      ) : null}

      {result.blockers.length === 0 && result.nothingToDo ? (
        <Alert tone="success" title="Already set up">
          <span className="block">{result.host} is already in Deparked and nothing is missing.</span>
          <Button asChild variant="outline" size="sm" className={cn("mt-3", WRAPS, "min-h-9")}>
            <Link to="/admin/d/$host" params={{ host: result.host }}>
              Open {result.host}
            </Link>
          </Button>
        </Alert>
      ) : null}

      {result.blockers.length === 0 && !result.nothingToDo ? (
        <>
          <div className="flex flex-col gap-4">
            <SetupItemList items={items} label="What Deparked sets up" />
            <UndoPromise />
            <ExpandableCard
              // Positioned, so the screen-reader-only text inside is clipped with the folded panel.
              className="relative"
              title="Every change, in detail"
              description={[
                creates.length > 0 ? plural(creates.length, "addition", "additions") : null,
                changes.length > 0 ? plural(changes.length, "change", "changes") : null,
              ]
                .filter((part) => part !== null)
                .join(", ")}
            >
              <div className="flex flex-col gap-3">
                {rest === "" ? null : <p className="[overflow-wrap:anywhere]">{rest}</p>}
                <EffectList title="Deparked will add" items={creates} />
                <EffectList title="Deparked will change" items={changes} />
                <EffectList title="Already in place, used as it is" items={effects("reuse")} />
                <p>
                  Deparked only adds. It never edits or deletes what it did not create, and Turn off on the domain's
                  settings undoes everything it did.
                </p>
              </div>
            </ExpandableCard>
          </div>

          {result.asks.length > 0 ? (
            <FieldSet className="rounded-2xl bg-card p-4 shadow-rest sm:p-5">
              <FieldLegend>Your yes</FieldLegend>
              <FieldDescription>Each of these touches something you have today.</FieldDescription>
              {result.asks.map((ask) => {
                const copy = confirmationCopy(result, ask);
                const id = `${hintId}-${ask}`;
                return (
                  <FieldLabel key={ask} htmlFor={id}>
                    <Field orientation="horizontal">
                      <Checkbox
                        id={id}
                        checked={given[ask] === true}
                        onCheckedChange={(checked) => setGiven((current) => ({ ...current, [ask]: checked === true }))}
                      />
                      <FieldContent>
                        <span className="font-medium [overflow-wrap:anywhere]">{copy.label}</span>
                        <FieldDescription className="[overflow-wrap:anywhere]">{copy.detail}</FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                );
              })}
            </FieldSet>
          ) : null}

          <div className="flex flex-col gap-3">
            {canStart ? null : (
              <p id={`${hintId}-hint`} className="text-sm text-muted-foreground">
                To continue, tick {missing.map((ask) => `“${confirmationCopy(result, ask).label}”`).join(" and ")}.
              </p>
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
              <BackToList />
              <Button
                variant="accent"
                size="lg"
                className={cn(WRAPS, "px-6")}
                disabled={!canStart}
                aria-describedby={canStart ? undefined : `${hintId}-hint`}
                onClick={() => props.onStart(result, given)}
              >
                Add {result.host}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div>
          <BackToList />
        </div>
      )}
    </Split>
  );
}

/** The progress line's words: the step running now, or where it stopped. */
function progressLabel(rows: readonly RunnerRow[]): string {
  const now = rows.find((row) => row.status === "running" || row.status === "waiting");
  if (now !== undefined) return now.status === "waiting" ? `${now.title} (waiting for another change)` : now.title;
  const stopped = rows.find((row) => row.status === "failed" || row.status === "blocked");
  if (stopped !== undefined) return `Stopped at: ${stopped.title}`;
  return rows.every((row) => row.status === "done" || row.status === "skipped") ? "Done" : "Starting…";
}

/** Every recorded step with what it did: the log behind "N things set up". */
function StepLog({ rows, label }: { rows: readonly RunnerRow[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className="flex gap-3">
          <span className="mt-0.5">
            <StatusIcon status={row.status} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">
              {row.title}
              <span className="sr-only">: {STATUS_WORDS[row.status]}</span>
            </p>
            {row.effects.length > 0 ? (
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {row.effects.map((effect) => (
                  <li key={effect.what} className="[overflow-wrap:anywhere]">
                    {effect.what}
                  </li>
                ))}
              </ul>
            ) : row.status === "skipped" ? (
              <p>Already in place.</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Step 3: the steps, one request each, as one progress line; on success the domain in its window. */
function DomainProgress(props: { preview: DomainPreview; confirmations: SetupConfirmations; onReview: () => void }) {
  const { host } = props.preview;
  const router = useRouter();
  const attach = useServerFn(attachStep);
  const detail = useServerFn(getDomainDetail);
  const [finished, setFinished] = useState(false);
  const [mail, setMail] = useState<OfferMail | null>(null);
  const steps = useMemo(() => props.preview.steps.map(({ id, title }) => ({ id, title })), [props.preview.steps]);
  const run: StepRun = useCallback(
    (state) => attach({ data: { host, confirmations: props.confirmations, state } }),
    [attach, host, props.confirmations],
  );
  const onFinished = useCallback(() => {
    setFinished(true);
    void router.invalidate();
    // Where its offers go was settled by the last step: say so if they are not emailed yet.
    detail({ data: { host } })
      .then((answer) => setMail(answer.domain?.mail ?? null))
      .catch(() => undefined);
  }, [router, detail, host]);
  const { rows, problem, running, announcement, retry } = useStepRunner({ steps, run, onFinished });
  const action = useRef<HTMLButtonElement>(null);

  // A stop moves focus to its way out, so the keyboard and the screen reader land on it.
  useEffect(() => {
    if (problem !== null) action.current?.focus();
  }, [problem]);

  const live = (
    <p aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );
  if (finished) return <DomainAdded host={host} rows={rows} mail={mail} live={live} />;

  const done = rows.filter((row) => row.status === "done" || row.status === "skipped").length;
  const stopped = rows.find((row) => row.status === "failed" || row.status === "blocked");
  return (
    <Split
      picture={
        <BrowserWindow address={host} className="mx-auto max-w-[460px]">
          <div aria-hidden="true" className="flex aspect-[16/10] flex-col justify-between bg-secondary p-6">
            <span className="h-2 w-20 rounded-full bg-input" />
            <span className="flex flex-col gap-2.5">
              <span className="h-5 w-3/4 animate-pulse rounded-md bg-input motion-reduce:animate-none" />
              <span className="h-2.5 w-1/2 rounded-full bg-border" />
            </span>
          </div>
        </BrowserWindow>
      }
    >
      <FlowTitle eyebrow="Adding" title={host} size="md">
        <p>You can leave this page. Adding it again picks up where it stopped.</p>
      </FlowTitle>
      <Progress value={done} max={rows.length} label={progressLabel(rows)} showValue />
      {live}
      {problem === null ? null : problem.credentialsRejected ? (
        <div className="flex flex-col gap-3">
          <CredentialsRejected />
          <div>
            <Button ref={action} variant="outline" onClick={() => void retry()} disabled={running}>
              Try again
            </Button>
          </div>
        </div>
      ) : problem.kind === "failed" ? (
        <Alert tone="danger" title={`“${stopped?.title ?? "A step"}” did not finish`}>
          <span className="block [overflow-wrap:anywhere]">{problem.message}</span>
          <span className="mt-1 block">Retry continues where it stopped. Nothing is done twice.</span>
          <Button
            ref={action}
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void retry()}
            disabled={running}
          >
            Retry
          </Button>
        </Alert>
      ) : (
        <Alert tone="warning" title={`“${stopped?.title ?? "A step"}” needs you`}>
          <span className="block [overflow-wrap:anywhere]">{problem.message}</span>
          <span className="mt-3 flex flex-wrap gap-2">
            <Button ref={action} variant="outline" size="sm" onClick={() => void retry()} disabled={running}>
              Check again
            </Button>
            <Button variant="outline" size="sm" className={cn(WRAPS, "min-h-9")} onClick={props.onReview}>
              Review {host} again
            </Button>
          </span>
        </Alert>
      )}
    </Split>
  );
}

/** The success screen: the domain's page live in its window, one next step, and the log folded away. */
function DomainAdded(props: { host: string; rows: readonly RunnerRow[]; mail: OfferMail | null; live: ReactNode }) {
  const { host } = props;
  const items = setupItems(props.rows);
  return (
    <div className="grid items-center gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Showcase celebrate tag={<LiveTag>Live now</LiveTag>}>
        <BrowserWindow address={host}>
          <PageThumbnail host={host} asServed />
        </BrowserWindow>
      </Showcase>
      <div className="flex min-w-0 flex-col gap-7">
        <FlowTitle title={`${host} is in the window.`} size="md">
          <p>Visitors already see a placeholder page. Give it a look of its own next.</p>
        </FlowTitle>
        {props.live}
        {props.mail === null ? null : <OfferMailNotice host={host} mail={props.mail} />}
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="accent" size="lg" className="h-12 px-7">
            <Link to="/admin/d/$host" params={{ host }}>
              Design its page
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-12 px-6">
            <a href={`https://${host}/`} target="_blank" rel="noreferrer">
              Visit it
              <ArrowUpRight aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Button>
        </div>
        <div className="max-w-[30rem]">
          <ExpandableCard
            // Positioned, so the screen-reader-only text inside is clipped with the folded panel.
            className="relative"
            title={`${items.length} ${items.length === 1 ? "thing" : "things"} set up`}
            description={itemsSummary(items)}
          >
            <StepLog rows={props.rows} label={`Steps that set up ${host}`} />
          </ExpandableCard>
        </div>
        <Link
          to="/admin/d/$host/settings"
          params={{ host }}
          className="inline-flex min-h-11 items-center self-start rounded-sm text-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Changed your mind? Turning it off undoes all of it.
        </Link>
      </div>
    </div>
  );
}

/** "+ Add domain": pick a zone, read what changes, confirm, watch it happen. Also how a turned-off domain comes back. */
export function AddDomainFlow({ host }: { host: string | undefined }) {
  const [started, setStarted] = useState<{
    for: string;
    preview: DomainPreview;
    confirmations: SetupConfirmations;
  } | null>(null);

  if (host === undefined) {
    return (
      <div className="flex max-w-3xl flex-col gap-8">
        <FlowTitle title="Add a domain">
          <p>Pick one from your Cloudflare account. Nothing changes until you say yes.</p>
        </FlowTitle>
        <DomainPicker />
      </div>
    );
  }
  if (started?.for === host) {
    return (
      <DomainProgress
        preview={started.preview}
        confirmations={started.confirmations}
        onReview={() => setStarted(null)}
      />
    );
  }
  return (
    <DomainReview
      key={host}
      host={host}
      onStart={(preview, confirmations) => setStarted({ for: host, preview, confirmations })}
    />
  );
}
