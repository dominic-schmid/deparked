import type {
  AccountDomain,
  DomainPreview,
  SetupConfirmation,
  SetupConfirmations,
  SetupEffect,
} from "@deparked/hosting";
import { Alert, AlertDescription, AlertTitle } from "@deparked/ui/alert";
import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { Checkbox } from "@deparked/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { Label } from "@deparked/ui/label";
import { Skeleton } from "@deparked/ui/skeleton";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { attachStep, listAccountDomains, previewDomain, type SetupFailure } from "../server/domain-setup/functions";
import { CredentialsRejected, SetupRunner, type StepRun } from "./setup-runner";

export const CLOUDFLARE_ADD_SITE_GUIDE = "https://developers.cloudflare.com/fundamentals/manage-domains/add-site/";

/** For buttons that name the domain: a long name wraps instead of leaving the screen. */
const WRAPS = "h-auto min-h-9 min-w-0 max-w-full shrink whitespace-normal py-2 [overflow-wrap:anywhere]";

const TEXT_LINK =
  "rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Failure({ failure, retry }: { failure: SetupFailure; retry: () => void }) {
  if (failure.credentialsRejected) return <CredentialsRejected message={failure.message} />;
  return (
    <Alert variant="destructive">
      <AlertTitle>Cloudflare did not answer as expected</AlertTitle>
      <AlertDescription>
        <p className="[overflow-wrap:anywhere]">{failure.message}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={retry}>
          Try again
        </Button>
      </AlertDescription>
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
      Domain not listed? Deparked works with domains that are on Cloudflare in this account. Add it to Cloudflare first
      with{" "}
      <a href={CLOUDFLARE_ADD_SITE_GUIDE} target="_blank" rel="noreferrer" className={TEXT_LINK}>
        Cloudflare's guide
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      , then come back.
    </p>
  );
}

/** Step 1: the domains of the Cloudflare account that Deparked does not manage yet. */
function DomainPicker() {
  const navigate = useNavigate();
  const list = useServerFn(listAccountDomains);
  const searchId = useId();
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
    <section aria-labelledby={`${searchId}-title`} className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 id={`${searchId}-title`} className="text-lg font-semibold">
          Pick a domain
        </h2>
        <p className="text-sm text-muted-foreground">
          These are the domains in your Cloudflare account. Nothing changes until you have seen what Deparked will do
          and said yes.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
        }}
      >
        <Label htmlFor={searchId} className="sr-only">
          Search your domains
        </Label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={searchId}
            type="search"
            name="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search your domains…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
      </form>
      {failure === null ? null : <Failure failure={failure} retry={() => void load(1, false)} />}
      {domains === null && failure === null ? (
        <div role="status" aria-label="Loading your domains" className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}
      {domains !== null && domains.length === 0 && !loading ? (
        <p className="rounded-xl border border-dashed p-4 text-sm">
          {query === ""
            ? "Every domain in your Cloudflare account is already in Deparked, or the account has none yet."
            : `No domain in your Cloudflare account contains “${query}” that is not already in Deparked.`}
        </p>
      ) : null}
      {domains !== null && domains.length > 0 ? (
        <ul aria-label="Domains you can add" aria-busy={loading} className="flex flex-col divide-y rounded-xl border">
          {domains.map((domain) => (
            <li key={domain.id}>
              <button
                type="button"
                onClick={() => void navigate({ to: "/admin/add", search: { host: domain.name } })}
                className="flex min-h-12 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 first:rounded-t-xl last:rounded-b-xl"
              >
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{domain.name}</span>
                {domain.active ? (
                  <span className="text-sm text-muted-foreground">Choose</span>
                ) : (
                  <Badge variant="outline">Not active on Cloudflare yet</Badge>
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
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground marker:text-muted-foreground/60">
        {items.map((item) => (
          <li key={item} className="[overflow-wrap:anywhere]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Step 2: what the domain serves today and what Deparked would change, then the owner's explicit yes. */
function DomainReview(props: {
  host: string;
  onStart: (preview: DomainPreview, confirmations: SetupConfirmations) => void;
}) {
  const navigate = useNavigate();
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

  const back = (
    <Button variant="outline" onClick={() => void navigate({ to: "/admin/add", search: {} })}>
      <ArrowLeft aria-hidden="true" />
      Choose another domain
    </Button>
  );

  if (result === null) {
    return (
      <div role="status" aria-label={`Looking at ${props.host}`} className="flex max-w-2xl flex-col gap-3">
        <p className="text-sm text-muted-foreground">Looking at what {props.host} does today…</p>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if ("ok" in result) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <Failure failure={result} retry={() => void load()} />
        <div>{back}</div>
      </div>
    );
  }

  const effects = (kind: SetupEffect["kind"]) =>
    result.steps.flatMap((step) => step.effects.filter((effect) => effect.kind === kind).map((effect) => effect.what));
  const missing = result.asks.filter((ask) => REQUIRED.includes(ask) && given[ask] !== true);
  const canStart = result.blockers.length === 0 && missing.length === 0;

  return (
    <section aria-labelledby={`${hintId}-title`} className="flex max-w-2xl flex-col gap-5">
      <div>
        <h2 id={`${hintId}-title`} className="text-lg font-semibold [overflow-wrap:anywhere]">
          {result.host}
        </h2>
        <p className="mt-1 text-pretty [overflow-wrap:anywhere]">{result.summary}</p>
      </div>

      {result.blockers.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Deparked cannot add this domain yet</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {result.blockers.map((blocker) => (
                <li key={blocker} className="[overflow-wrap:anywhere]">
                  {blocker}
                </li>
              ))}
            </ul>
            {result.inAccount ? null : <NotOnCloudflare />}
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
              Check again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {result.blockers.length === 0 && result.nothingToDo ? (
        <Alert>
          <AlertTitle>Already set up</AlertTitle>
          <AlertDescription>
            <p>{result.host} is already in Deparked and nothing is missing.</p>
            <Button asChild variant="outline" size="sm" className={`mt-2 ${WRAPS}`}>
              <Link to="/admin/d/$host" params={{ host: result.host }}>
                Open {result.host}
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {result.blockers.length === 0 && !result.nothingToDo ? (
        <>
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <EffectList title="Deparked will add" items={effects("create")} />
            <EffectList title="Deparked will change" items={effects("change")} />
            <EffectList title="Already in place, used as it is" items={effects("reuse")} />
            <p className="text-sm text-muted-foreground">
              Deparked only adds. It never edits or deletes what it did not create, and Turn off on the domain's page
              undoes everything it did.
            </p>
          </div>

          {result.asks.length > 0 ? (
            <FieldSet>
              <FieldLegend>Your confirmation</FieldLegend>
              <FieldDescription>Each of these touches something you have today. Say yes to each one.</FieldDescription>
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

          {canStart ? null : (
            <p id={`${hintId}-hint`} className="text-sm text-muted-foreground">
              To continue, tick {missing.map((ask) => `“${confirmationCopy(result, ask).label}”`).join(" and ")}.
            </p>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            {back}
            <Button
              className={WRAPS}
              disabled={!canStart}
              aria-describedby={canStart ? undefined : `${hintId}-hint`}
              onClick={() => props.onStart(result, given)}
            >
              Add {result.host}
            </Button>
          </div>
        </>
      ) : (
        <div>{back}</div>
      )}
    </section>
  );
}

/** Step 3: the steps, one request each, and the way out once they are done. */
function DomainProgress(props: { preview: DomainPreview; confirmations: SetupConfirmations; onReview: () => void }) {
  const { host } = props.preview;
  const router = useRouter();
  const attach = useServerFn(attachStep);
  const [finished, setFinished] = useState(false);
  const steps = useMemo(() => props.preview.steps.map(({ id, title }) => ({ id, title })), [props.preview.steps]);
  const run: StepRun = useCallback(
    (state) => attach({ data: { host, confirmations: props.confirmations, state } }),
    [attach, host, props.confirmations],
  );
  const onFinished = useCallback(() => {
    setFinished(true);
    void router.invalidate();
  }, [router]);

  return (
    <section aria-labelledby="progress-title" className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 id="progress-title" className="text-lg font-semibold [overflow-wrap:anywhere]">
          {finished ? `${host} is set up` : `Setting up ${host}`}
        </h2>
        <p className="text-sm text-muted-foreground">
          {finished
            ? "It shows a placeholder page with a link to this admin until you publish its design."
            : "One step at a time. You can leave this page: adding the domain again picks up where it stopped."}
        </p>
      </div>
      <SetupRunner
        steps={steps}
        run={run}
        onFinished={onFinished}
        label={`Steps to set up ${host}`}
        blockedAction={
          <Button variant="outline" size="sm" className={WRAPS} onClick={props.onReview}>
            Review {host} again
          </Button>
        }
      />
      {finished ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button asChild>
            <Link to="/admin/d/$host" params={{ host }}>
              Design its page
            </Link>
          </Button>
          <Button asChild variant="outline" className={WRAPS}>
            <a href={`https://${host}/`} target="_blank" rel="noreferrer">
              Visit {host}
              <ExternalLink aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/admin">All domains</Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** "+ Add domain": pick a zone, read what changes, confirm, watch it happen. Also how a turned-off domain comes back. */
export function AddDomainFlow({ host }: { host: string | undefined }) {
  const [started, setStarted] = useState<{
    for: string;
    preview: DomainPreview;
    confirmations: SetupConfirmations;
  } | null>(null);

  if (host === undefined) return <DomainPicker />;
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
