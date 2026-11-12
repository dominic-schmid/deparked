import type { SetupEffect } from "@deparked/hosting";
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
import { Skeleton } from "@deparked/ui/skeleton";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { describeChange, type SetupFailure, takeOffStep } from "../server/domain-setup/functions";
import type { DisplayStatus } from "../server/domains";
import type { PendingChange } from "../server/pending-change";
import { CredentialsRejected, SetupRunner, type StepRun } from "./setup-runner";

type Change = "turn-off" | "remove";

type Description = {
  steps: { id: string; title: string }[];
  removal: { effects: SetupEffect[]; keeps: string[] } | null;
};

const VERB: Record<SetupEffect["kind"], string> = {
  create: "Adds",
  change: "Changes",
  remove: "Removes",
  restore: "",
  reuse: "Leaves",
};

const COPY: Record<Change, { title: string; action: string; running: string; done: string; intro: string }> = {
  "turn-off": {
    title: "Turn off",
    action: "Turn off",
    running: "Turning off",
    done: "Turned off",
    intro:
      "Visitors get what the domain served before Deparked: everything Deparked added is removed and everything it changed is put back.",
  },
  remove: {
    title: "Remove from Deparked",
    action: "Remove",
    running: "Removing",
    done: "Removed",
    intro: "Turns the domain off, then takes it off the list of domains. You can add it again later from “Add domain”.",
  },
};

function ChangeDialog(props: {
  host: string;
  change: Change;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (description: Description) => void;
}) {
  const describe = useServerFn(describeChange);
  const [result, setResult] = useState<Description | SetupFailure | null>(null);
  const copy = COPY[props.change];

  const load = useCallback(async () => {
    setResult(null);
    try {
      const answer = await describe({ data: { host: props.host, change: props.change } });
      setResult(answer.ok ? answer.value : answer);
    } catch {
      setResult({ ok: false, credentialsRejected: false, message: "The admin did not answer. Nothing was changed." });
    }
  }, [describe, props.host, props.change]);

  useEffect(() => {
    if (props.open) void load();
  }, [props.open, load]);

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">
            {copy.action} {props.host}?
          </AlertDialogTitle>
          <AlertDialogDescription>{copy.intro}</AlertDialogDescription>
        </AlertDialogHeader>
        {result === null ? (
          <div role="status" aria-label="Loading what changes" className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : "ok" in result ? (
          result.credentialsRejected ? (
            <CredentialsRejected message={result.message} />
          ) : (
            <p className="text-sm text-destructive [overflow-wrap:anywhere]">{result.message}</p>
          )
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <h3 className="font-medium">In Cloudflare</h3>
              {result.removal === null || result.removal.effects.length === 0 ? (
                <p className="text-muted-foreground">Nothing: Deparked has nothing set up there for this domain.</p>
              ) : (
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {result.removal.effects.map((effect) => (
                    <li key={`${effect.kind}:${effect.what}`} className="[overflow-wrap:anywhere]">
                      {effect.kind === "restore"
                        ? `${effect.what.charAt(0).toUpperCase()}${effect.what.slice(1)}`
                        : `${VERB[effect.kind]} ${effect.what}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="font-medium">Then</h3>
              <p className="text-muted-foreground">
                The domain's pages are taken offline
                {props.change === "remove" ? " and it leaves the list of domains." : "."}
              </p>
            </div>
            {result.removal === null ? null : (
              <div>
                <h3 className="font-medium">Stays</h3>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {result.removal.keeps.map((keep) => (
                    <li key={keep} className="[overflow-wrap:anywhere]">
                      {keep}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={props.change === "remove" ? "destructive" : "default"}
            disabled={result === null || "ok" in result}
            onClick={() => {
              if (result !== null && !("ok" in result)) props.onConfirm(result);
            }}
          >
            {copy.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ChangeProgress(props: { host: string; change: Change; steps: Description["steps"] }) {
  const router = useRouter();
  const navigate = useNavigate();
  const step = useServerFn(takeOffStep);
  const [finished, setFinished] = useState(false);
  const { host, change } = props;
  const run: StepRun = useCallback((state) => step({ data: { host, change, state } }), [step, host, change]);
  const onFinished = useCallback(() => {
    setFinished(true);
    if (change === "remove") void navigate({ to: "/admin" });
    else void router.invalidate();
  }, [change, navigate, router]);
  const copy = COPY[change];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium" aria-live="polite">
        {finished ? `${copy.done}.` : `${copy.running} ${host}…`}
      </p>
      <SetupRunner
        steps={props.steps}
        run={run}
        onFinished={onFinished}
        label={`Steps to ${copy.action.toLowerCase()} ${host}`}
      />
    </div>
  );
}

function ChangeCard(props: { host: string; change: Change; description: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<Description["steps"] | null>(null);
  const copy = COPY[props.change];
  return (
    <Card className={props.change === "remove" ? "border-destructive/40" : undefined}>
      <CardHeader>
        <CardTitle>
          <h2>{props.title ?? copy.title}</h2>
        </CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {running === null ? (
          <>
            <Button variant={props.change === "remove" ? "destructive" : "outline"} onClick={() => setOpen(true)}>
              {props.title ?? copy.action}…
            </Button>
            <ChangeDialog
              host={props.host}
              change={props.change}
              open={open}
              onOpenChange={setOpen}
              onConfirm={(description) => {
                setOpen(false);
                setRunning(description.steps);
              }}
            />
          </>
        ) : (
          <ChangeProgress host={props.host} change={props.change} steps={running} />
        )}
      </CardContent>
    </Card>
  );
}

const ON_COPY = {
  off: {
    title: "Turned off",
    text: (host: string) =>
      `${host} serves what it served before Deparked. Its design and offers are kept, so turning it on again brings the page back as it was.`,
    action: "Turn on…",
  },
  adding: {
    title: "Not added yet",
    text: (host: string) =>
      `Adding ${host} stopped half-way: some of its settings are in Cloudflare, but the for-sale page is not on. Continuing picks up where it stopped.`,
    action: "Continue adding…",
  },
  "turning-on": {
    title: "Not on yet",
    text: (host: string) =>
      `Turning ${host} on again stopped half-way. Continuing picks up where it stopped; its design and offers are kept.`,
    action: "Continue turning on…",
  },
};

/** Turn off, Turn on and Remove for one domain, and the way to finish a change that stopped half-way. */
export function DomainActions(props: { host: string; status: DisplayStatus; pending: PendingChange | null }) {
  const { host, status, pending } = props;
  const off = status === "off";
  const on = ON_COPY[pending === "adding" || pending === "turning-on" ? pending : "off"];
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {pending === "turning-off" || pending === "unclear" ? (
        <ChangeCard
          host={host}
          change="turn-off"
          title="Finish turning off"
          description={`Turning ${host} off stopped half-way: some of Deparked's settings, or its pages, are still in place. Finishing checks every step again and removes what is left.`}
        />
      ) : null}
      {off ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{on.title}</h2>
            </CardTitle>
            <CardDescription>{on.text(host)}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/admin/add" search={{ host }}>
                {on.action}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : pending === "turning-off" ? null : (
        <ChangeCard
          host={host}
          change="turn-off"
          description={`Stops showing the for-sale page on ${host} and gives the address back to what it served before. The design and the offers stay.`}
        />
      )}
      <ChangeCard
        host={host}
        change="remove"
        description={`Turns ${host} off and takes it off the list. Its offers stay in the database.`}
      />
    </div>
  );
}
