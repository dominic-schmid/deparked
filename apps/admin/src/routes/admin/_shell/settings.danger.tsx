import { Alert, AlertDescription } from "@deparked/ui/alert";
import { Button } from "@deparked/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { Field, FieldDescription, FieldLabel } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useCallback, useId, useState } from "react";
import { PageError, PagePending } from "../../../components/page";
import { CredentialsRejected, SetupRunner, type StepRun } from "../../../components/setup-runner";
import { describeUninstall, uninstallStep } from "../../../server/hub/functions";
import { UNINSTALL_CONFIRMATION, uninstallConfirmationSchema } from "../../../server/hub/hub";

export const Route = createFileRoute("/admin/_shell/settings/danger")({
  loader: () => describeUninstall(),
  head: () => ({ meta: [{ title: "Danger zone · Deparked" }] }),
  component: DangerZone,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

function Progress(props: { steps: { id: string; title: string }[]; confirmation: string }) {
  const step = useServerFn(uninstallStep);
  const [finished, setFinished] = useState(false);
  const { confirmation } = props;
  const total = props.steps.length;
  const run: StepRun = useCallback(
    async (state) => {
      try {
        return await step({ data: { confirmation, state } });
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
    [step, confirmation, total],
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

function DangerZone() {
  const described = Route.useLoaderData();
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const confirmId = useId();
  const helpId = useId();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
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
            undone.{" "}
            <a href="/admin/offers.csv" className="font-medium text-foreground underline underline-offset-4">
              Export your offers
            </a>{" "}
            first.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 text-sm">
          {!described.ok ? (
            described.credentialsRejected ? (
              <CredentialsRejected message={described.message} />
            ) : (
              <Alert variant="destructive">
                <AlertDescription>{described.message}</AlertDescription>
              </Alert>
            )
          ) : running !== null ? (
            <Progress steps={described.value.steps} confirmation={running} />
          ) : (
            <>
              <div>
                <h3 className="font-medium">Deleted or put back</h3>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {described.value.effects.map((effect) => (
                    <li key={`${effect.kind}:${effect.what}`} className="[overflow-wrap:anywhere]">
                      {capitalize(effect.what)}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-medium">Stays</h3>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {described.value.keeps.map((keep) => (
                    <li key={keep} className="[overflow-wrap:anywhere]">
                      {capitalize(keep)}
                    </li>
                  ))}
                </ul>
              </div>
              <form onSubmit={onSubmit} className="flex flex-col gap-3">
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
                  <FieldDescription id={helpId}>
                    {problem ?? "Every step is safe to repeat: if one fails, Retry continues where it stopped."}
                  </FieldDescription>
                </Field>
                <div>
                  <Button type="submit" variant="destructive">
                    Uninstall
                  </Button>
                </div>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
