import { Alert, AlertDescription } from "@deparked/ui/alert";
import { Button } from "@deparked/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { Checkbox } from "@deparked/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { Label } from "@deparked/ui/label";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Download } from "lucide-react";
import { type FormEvent, useCallback, useId, useState } from "react";
import { PageError, PagePending } from "../../../components/page";
import { CredentialsRejected, SetupRunner, type StepRun } from "../../../components/setup-runner";
import { RelativeTime } from "../../../components/time";
import { describeUninstall, uninstallStep } from "../../../server/hub/functions";
import { UNINSTALL_CONFIRMATION, uninstallConfirmationSchema } from "../../../server/hub/hub";
import { getUninstallFacts } from "../../../server/uninstall.functions";
import { type UninstallFacts, uninstallCopyGate } from "../../../server/uninstall-gate";

export const Route = createFileRoute("/admin/_shell/settings/danger")({
  loader: async () => {
    const [described, { facts, now }] = await Promise.all([describeUninstall(), getUninstallFacts()]);
    return { described, facts, now };
  },
  // The copy of the offers is judged on fresh facts.
  staleTime: 0,
  head: () => ({ meta: [{ title: "Danger zone · Deparked" }] }),
  component: DangerZone,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

function Progress(props: { steps: { id: string; title: string }[]; confirmation: string; waived: boolean }) {
  const step = useServerFn(uninstallStep);
  const [finished, setFinished] = useState(false);
  const { confirmation, waived } = props;
  const total = props.steps.length;
  const run: StepRun = useCallback(
    async (state) => {
      try {
        return await step({ data: { confirmation, waived, state } });
      } catch (error) {
        // The last step deletes this admin: an answer lost right after it is the admin being gone, not a failure.
        if (state.next !== total - 1) throw error;
        return {
          ok: true,
          value: {
            step: null,
            outcome: "ran",
            message: "",
            effects: [],
            state: { next: total },
            finished: true,
            credentialsRejected: false,
          },
        };
      }
    },
    [step, confirmation, waived, total],
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium" aria-live="polite">
        {finished
          ? "Deparked is uninstalled. This admin panel is gone: close this tab."
          : "Uninstalling Deparked… Keep this tab open until every step is done."}
      </p>
      <SetupRunner
        steps={props.steps}
        run={run}
        onFinished={() => setFinished(true)}
        label="Steps to uninstall Deparked"
      />
    </div>
  );
}

const TEXT_LINK =
  "rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function count(value: number, one: string, many: string): string {
  return `${value.toLocaleString("en")} ${value === 1 ? one : many}`;
}

/** A copy of the offers, or the owner's word that they need none, before anything can be deleted. */
function OffersCopy(props: {
  facts: UninstallFacts;
  now: number;
  started: boolean;
  onDownload: () => void;
  waived: boolean;
  onWaive: (waived: boolean) => void;
}) {
  const { facts } = props;
  const waiveId = useId();
  if (facts.offers === 0) {
    return <p className="text-muted-foreground">There are no offers to keep a copy of.</p>;
  }
  const current = facts.exportedAt !== null && facts.exportedAt >= (facts.newestOfferAt ?? 0);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground">
        Uninstall deletes the admin, so the inbox goes with it. Keep a copy of your offers first.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild variant="outline">
          <a href="/admin/offers.csv" download onClick={props.onDownload}>
            <Download aria-hidden="true" />
            Download {count(facts.offers, "offer", "offers")} (CSV)
          </a>
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {props.started ? (
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <Check aria-hidden="true" className="size-4 text-emerald-600 dark:text-emerald-400" />
              Download started
            </span>
          ) : current && facts.exportedAt !== null ? (
            <>
              Downloaded <RelativeTime time={facts.exportedAt} now={props.now} />
            </>
          ) : facts.exportedAt !== null ? (
            "An offer arrived after your last download."
          ) : null}
        </p>
      </div>
      <div className="flex items-start gap-3">
        <Checkbox
          id={waiveId}
          checked={props.waived}
          onCheckedChange={(checked) => props.onWaive(checked === true)}
          className="mt-0.5"
        />
        <Label htmlFor={waiveId} className="leading-snug font-normal">
          I don't need a copy of my offers
        </Label>
      </div>
    </div>
  );
}

function DangerZone() {
  const { described, facts, now } = Route.useLoaderData();
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [waived, setWaived] = useState(false);
  const confirmId = useId();
  const helpId = useId();
  const gateId = useId();
  // A download started on this page counts at once; the server recorded it when it answered.
  const gate = uninstallCopyGate(started ? { ...facts, exportedAt: Number.MAX_SAFE_INTEGER } : facts, waived);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!gate.ok) {
      setProblem(gate.reason);
      return;
    }
    const parsed = uninstallConfirmationSchema.safeParse(typed);
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? "Type the words to confirm.");
      return;
    }
    setProblem(null);
    setRunning(parsed.data);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Remove a domain</h2>
          </CardTitle>
          <CardDescription>
            Each domain's own Settings tab has Turn off and Remove, with a list of what they undo.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>
            <h2>Uninstall Deparked</h2>
          </CardTitle>
          <CardDescription>
            Turns every domain off, then deletes everything Deparked created in your Cloudflare account. It cannot be
            undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 text-sm">
          {!described.ok ? (
            described.credentialsRejected ? (
              <CredentialsRejected message={described.message} />
            ) : (
              <Alert variant="destructive">
                <AlertDescription>{described.message}</AlertDescription>
              </Alert>
            )
          ) : running !== null ? (
            <Progress steps={described.value.steps} confirmation={running} waived={waived} />
          ) : (
            <>
              <p className="rounded-lg bg-muted px-3 py-2.5 tabular-nums">
                This workspace has{" "}
                <strong className="font-semibold">{count(facts.domains, "domain", "domains")}</strong> and{" "}
                <strong className="font-semibold">{count(facts.offers, "offer", "offers")}</strong>.
              </p>
              <section aria-labelledby={`${gateId}-copy`} className="flex flex-col gap-2">
                <h3 id={`${gateId}-copy`} className="font-medium">
                  1. Keep your offers
                </h3>
                <OffersCopy
                  facts={facts}
                  now={now}
                  started={started}
                  onDownload={() => setStarted(true)}
                  waived={waived}
                  onWaive={setWaived}
                />
              </section>
              <section aria-labelledby={`${gateId}-effects`} className="flex flex-col gap-3">
                <h3 id={`${gateId}-effects`} className="font-medium">
                  2. Read what happens
                </h3>
                <div>
                  <h4 className="text-muted-foreground">Deleted or put back in Cloudflare</h4>
                  <ul className="mt-1 list-disc pl-5 marker:text-muted-foreground/60">
                    {described.value.effects.map((effect) => (
                      <li key={`${effect.kind}:${effect.what}`} className="[overflow-wrap:anywhere]">
                        {capitalize(effect.what)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-muted-foreground">Stays</h4>
                  <ul className="mt-1 list-disc pl-5 marker:text-muted-foreground/60">
                    {/* The database gets its own box below, with how to delete it. */}
                    {described.value.keeps
                      .filter((keep) => !keep.startsWith("the database"))
                      .map((keep) => (
                        <li key={keep} className="[overflow-wrap:anywhere]">
                          {capitalize(keep)}
                        </li>
                      ))}
                  </ul>
                </div>
                <div className="rounded-lg border p-3">
                  <h4 className="font-medium">The database stays: delete it afterwards</h4>
                  <p className="mt-1 text-muted-foreground">
                    The D1 database <code className="font-mono text-foreground">deparked</code> keeps your offers,
                    designs and settings, because this admin needs it until its last step. Once Uninstall is done,
                    delete it in the{" "}
                    <a href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer" className={TEXT_LINK}>
                      Cloudflare dashboard
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                    : Storage &amp; databases, D1, <span translate="no">deparked</span>, Settings, Delete.
                  </p>
                </div>
              </section>
              <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-labelledby={`${gateId}-confirm`}>
                <h3 id={`${gateId}-confirm`} className="font-medium">
                  3. Confirm
                </h3>
                <Field>
                  <FieldLabel htmlFor={confirmId}>Type “{UNINSTALL_CONFIRMATION}” to confirm</FieldLabel>
                  <Input
                    id={confirmId}
                    autoComplete="off"
                    spellCheck={false}
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    aria-describedby={helpId}
                    aria-invalid={problem !== null}
                  />
                  <FieldDescription id={helpId} className={problem === null ? undefined : "text-destructive"}>
                    {problem ?? "Every step is safe to repeat: if one fails, Retry continues where it stopped."}
                  </FieldDescription>
                </Field>
                <div>
                  <Button
                    type="submit"
                    variant="destructive"
                    aria-disabled={!gate.ok}
                    aria-describedby={gate.ok ? undefined : `${gateId}-gate`}
                  >
                    Uninstall Deparked
                  </Button>
                  {gate.ok ? null : (
                    <p id={`${gateId}-gate`} className="mt-2 text-muted-foreground">
                      {gate.reason}
                    </p>
                  )}
                </div>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
