import { Card } from "@deparked/ui/arc/card";
import { Button } from "@deparked/ui/button";
import { cn } from "@deparked/ui/lib/utils";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { type ReactNode, useState } from "react";
import { dismissSetupChecklist } from "../server/domains.functions";
import { checkNotify } from "../server/notify.functions";
import type { ChecklistStepId, SetupChecklist } from "../server/setup-checklist";

type StepCopy = { title: string; detail: ReactNode; action: ReactNode | undefined };

function Email({ children }: { children: string }) {
  return (
    <span className="font-medium text-foreground [overflow-wrap:anywhere]" translate="no">
      {children}
    </span>
  );
}

function CheckButton({ onResult }: { onResult: (text: string) => void }) {
  const router = useRouter();
  const check = useServerFn(checkNotify);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      aria-disabled={busy}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          const result = await check();
          await router.invalidate();
          onResult(
            result.ok ? "Not verified yet. Click the link in the newest email from Cloudflare." : result.message,
          );
        } catch {
          onResult("The admin did not answer. Check the connection and try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Checking…" : "Check again"}
    </Button>
  );
}

/**
 * "Finish setting up" on the home screen: the four steps of a working install, each with its real state and the one
 * action that does it. Read-only: a step is done when the server says so, never by a tick. An Arc card; hiding it
 * hides it for good, and Settings and Add a domain still reach everything.
 */
export function SetupChecklistCard({ checklist }: { checklist: SetupChecklist }) {
  const router = useRouter();
  const dismiss = useServerFn(dismissSetupChecklist);
  const [note, setNote] = useState("");
  const [hidden, setHidden] = useState(false);
  const done = new Map(checklist.steps.map((step) => [step.id, step.done]));
  const { email, host } = checklist;

  const linkAction = (link: ReactNode) => (
    <Button asChild variant="outline" size="sm">
      {link}
    </Button>
  );

  const copy: Record<ChecklistStepId, StepCopy> = {
    address: {
      title: "Add an address for offers",
      detail:
        done.get("address") && email !== null ? (
          <>
            Offers go to <Email>{email}</Email>.
          </>
        ) : (
          "Offers are kept here, and emailed once an address is verified."
        ),
      action: linkAction(<Link to="/admin/settings">Add an address</Link>),
    },
    verify: {
      title: "Verify the address",
      detail:
        email === null ? (
          "Cloudflare emails a link to the address you add. Click it once."
        ) : done.get("verify") ? (
          <>
            <Email>{email}</Email> is verified.
          </>
        ) : (
          <>
            Click the link in Cloudflare's email to <Email>{email}</Email>.
          </>
        ),
      action: email === null ? undefined : <CheckButton onResult={setNote} />,
    },
    domain: {
      title: "Add your first domain",
      detail:
        done.get("domain") && host !== null ? (
          <>
            <Email>{host}</Email> is added.
          </>
        ) : (
          "Pick one from your Cloudflare account. Nothing changes before you say yes."
        ),
      action: linkAction(<Link to="/admin/add">Choose a domain</Link>),
    },
    publish: {
      title: "Publish its design",
      detail:
        host === null ? (
          "Choose a design and wording, then publish it."
        ) : done.get("publish") ? (
          "A design is live."
        ) : (
          <>
            <Email>{host}</Email> shows a placeholder until you publish a design.
          </>
        ),
      action:
        host === null
          ? undefined
          : linkAction(
              <Link to="/admin/d/$host" params={{ host }}>
                Open the editor
              </Link>,
            ),
    },
  };

  if (hidden) return null;
  const count = checklist.steps.filter((step) => step.done).length;

  return (
    <Card
      title="Finish setting up"
      description={`${count} of ${checklist.steps.length} done. This card goes away by itself once the last step is done.`}
      // A container, not a target: it neither lifts nor shadows on hover.
      className="w-full max-w-2xl border-transparent shadow-lift transform-none! data-[hover]:shadow-lift [&_h3]:font-heading [&_h3]:text-xl [&_h3]:font-bold [&_p]:max-w-none"
      action={
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          title="Hide these steps for good. Everything stays reachable from Settings and Add a domain."
          onClick={async () => {
            setHidden(true);
            try {
              await dismiss();
            } finally {
              await router.invalidate();
            }
          }}
        >
          Hide for good
        </Button>
      }
    >
      <ol className="mt-4 flex flex-col divide-y divide-border rounded-2xl bg-background/60">
        {checklist.steps.map((step, index) => {
          const { title, detail, action } = copy[step.id];
          return (
            <li
              key={step.id}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-x-4"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-px grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums sm:mt-0",
                  step.done ? "bg-positive text-white" : "border border-input text-muted-foreground",
                )}
              >
                {step.done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm font-medium", step.done && "text-muted-foreground line-through")}>
                  {title}
                  <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                </p>
                <p className="text-sm text-pretty text-muted-foreground">{detail}</p>
              </div>
              {step.done || action === undefined ? null : <div className="col-start-2 sm:col-start-3">{action}</div>}
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="mt-3 text-sm empty:hidden [overflow-wrap:anywhere]">
        {note}
      </p>
    </Card>
  );
}
