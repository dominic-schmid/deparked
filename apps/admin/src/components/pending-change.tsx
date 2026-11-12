import { Alert, AlertDescription, AlertTitle } from "@deparked/ui/alert";
import { Button } from "@deparked/ui/button";
import { Link } from "@tanstack/react-router";
import { CircleDashed } from "lucide-react";
import type { PendingChange } from "../server/pending-change";

function ContinueAdding({ host, label }: { host: string; label: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/admin/add" search={{ host }}>
        {label}
      </Link>
    </Button>
  );
}

function FinishTurningOff({ host }: { host: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/admin/d/$host/settings" params={{ host }}>
        Finish turning off
      </Link>
    </Button>
  );
}

/** A change that stopped half-way: what it was, and the action that finishes it. */
export function PendingChangeNotice({ host, pending }: { host: string; pending: PendingChange | null }) {
  if (pending === null) return null;
  const body =
    pending === "unclear" ? (
      <>
        <p>Deparked cannot tell which one stopped. Either is safe to run: each checks every step again.</p>
        <ul className="mt-2 flex flex-col gap-2">
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ContinueAdding host={host} label="Continue adding" />
            <span>if you were adding it or turning it on.</span>
          </li>
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <FinishTurningOff host={host} />
            <span>if you were turning it off.</span>
          </li>
        </ul>
      </>
    ) : pending === "turning-off" ? (
      <>
        <p>Some of Deparked's settings for it, or its pages, are still in place. Finishing checks every step again.</p>
        <div className="mt-2">
          <FinishTurningOff host={host} />
        </div>
      </>
    ) : (
      <>
        <p>
          Some of its settings are in Cloudflare, but the for-sale page is not on yet. Continuing picks up where it
          stopped.
        </p>
        <div className="mt-2">
          <ContinueAdding host={host} label={pending === "adding" ? "Continue adding" : "Continue turning on"} />
        </div>
      </>
    );
  const title = {
    adding: `Adding ${host} stopped half-way`,
    "turning-on": `Turning ${host} on again stopped half-way`,
    "turning-off": `Turning ${host} off stopped half-way`,
    unclear: `A change to ${host} stopped half-way`,
  }[pending];
  return (
    <Alert role="note" className="mb-6">
      <CircleDashed aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{body}</AlertDescription>
    </Alert>
  );
}
