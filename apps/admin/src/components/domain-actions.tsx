import type { SetupEffect } from "@deparked/hosting";
import { Alert } from "@deparked/ui/arc/alert";
import { Skeleton } from "@deparked/ui/arc/skeleton";
import { Button } from "@deparked/ui/button";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, CloudOff, Inbox, Palette, Power, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { describeChange, type SetupFailure, takeOffStep } from "../server/domain-setup/functions";
import type { DisplayStatus } from "../server/domains";
import type { PendingChange } from "../server/pending-change";
import { ConfirmDialog } from "./confirm-dialog";
import { effectRows, IconRows, keepRows, SettingsSection } from "./settings-ui";
import { CredentialsRejected, SetupRunner, type StepRun } from "./setup-runner";

type Change = "turn-off" | "remove";

type Description = {
  steps: { id: string; title: string }[];
  removal: { effects: SetupEffect[]; keeps: string[] } | null;
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

/** The confirmation: what the change undoes and what it keeps, read from the server before anything happens. */
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

  const ready = result !== null && !("ok" in result) ? result : null;
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={`${copy.action} ${props.host}?`}
      description={copy.intro}
      cancel="Cancel"
      confirm={copy.action}
      tone={props.change === "remove" ? "danger" : "default"}
      confirmDisabled={ready === null}
      onConfirm={() => {
        if (ready !== null) props.onConfirm(ready);
      }}
    >
      {result === null ? (
        <Skeleton label="Loading what changes" lines={3} />
      ) : "ok" in result ? (
        result.credentialsRejected ? (
          <CredentialsRejected message={result.message} />
        ) : (
          <Alert tone="danger" title="Nothing can be changed right now">
            <span className="[overflow-wrap:anywhere]">{result.message}</span>
          </Alert>
        )
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">Undone in Cloudflare</h3>
            {result.removal === null || result.removal.effects.length === 0 ? (
              <p className="text-muted-foreground">Nothing: Deparked has nothing set up there for this domain.</p>
            ) : (
              <IconRows label="Undone in Cloudflare" rows={effectRows(result.removal.effects, true)} />
            )}
            <IconRows
              label="Then"
              rows={[
                {
                  key: "offline",
                  icon: CloudOff,
                  tone: "danger",
                  text: `The domain's pages are taken offline${props.change === "remove" ? " and it leaves the list of domains." : "."}`,
                },
              ]}
            />
          </div>
          {result.removal === null || result.removal.keeps.length === 0 ? null : (
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">Kept</h3>
              <IconRows label="Kept" rows={keepRows(result.removal.keeps)} />
            </div>
          )}
        </>
      )}
    </ConfirmDialog>
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

/** A section with one change: its line, its button, the confirmation, then its steps once confirmed. */
function ChangeSection(props: { host: string; change: Change; lead: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<Description["steps"] | null>(null);
  const copy = COPY[props.change];
  const remove = props.change === "remove";
  return (
    <SettingsSection
      title={props.title ?? copy.title}
      lead={props.lead}
      {...(remove ? { tone: "danger" as const } : {})}
    >
      {running === null ? (
        <>
          <div>
            <Button variant={remove ? "destructive" : "outline"} onClick={() => setOpen(true)}>
              {remove ? <Trash2 aria-hidden="true" /> : <Power aria-hidden="true" />}
              {props.title ?? copy.action}…
            </Button>
          </div>
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
    </SettingsSection>
  );
}

const ON_COPY = {
  off: {
    title: "Turned off",
    text: (host: string) =>
      `${host} serves what it served before Deparked. Turning it on again brings the page back as it was.`,
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
    <>
      {pending === "turning-off" || pending === "unclear" ? (
        <ChangeSection
          host={host}
          change="turn-off"
          title="Finish turning off"
          lead={`Turning ${host} off stopped half-way: some of Deparked's settings, or its pages, are still in place. Finishing checks every step again and removes what is left.`}
        />
      ) : null}
      {off ? (
        <SettingsSection title={on.title} lead={on.text(host)}>
          <IconRows
            label="Kept while it is off"
            rows={[
              { key: "design", icon: Palette, tone: "positive", text: "Its page design" },
              { key: "offers", icon: Inbox, tone: "positive", text: "The offers it received" },
              { key: "steps", icon: Check, tone: "neutral", text: "Turning on runs the same steps as adding it" },
            ]}
          />
          <div>
            <Button asChild>
              <Link to="/admin/add" search={{ host }}>
                <Power aria-hidden="true" />
                {on.action}
              </Link>
            </Button>
          </div>
        </SettingsSection>
      ) : pending === "turning-off" ? null : (
        <ChangeSection
          host={host}
          change="turn-off"
          lead={`Stops showing the for-sale page on ${host} and gives the address back to what it served before. The design and the offers stay.`}
        />
      )}
      <ChangeSection
        host={host}
        change="remove"
        lead={`Turns ${host} off and takes it off the list. Its offers stay in the database.`}
      />
    </>
  );
}
