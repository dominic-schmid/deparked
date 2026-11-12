import { Button } from "@deparked/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { cn } from "@deparked/ui/lib/utils";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, X } from "lucide-react";
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

/** "Finish setting up" on the overview: the four steps of a working install, each with its state and one action. */
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
          "Offers are kept in the inbox, and emailed once an address is verified."
        ),
      action: linkAction(<Link to="/admin/settings">Add address</Link>),
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
    <Card className="mb-6 gap-4">
      <CardHeader>
        <CardTitle>
          <h2>Finish setting up</h2>
        </CardTitle>
        <CardDescription>
          <span className="tabular-nums">
            {count} of {checklist.steps.length}
          </span>{" "}
          done. This card goes away by itself once the last step is done.
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            className="-mt-1 -mr-2 text-muted-foreground"
            title="Hide these steps for good. Everything stays reachable from Settings and Add domain."
            onClick={async () => {
              setHidden(true);
              try {
                await dismiss();
              } finally {
                await router.invalidate();
              }
            }}
          >
            <X aria-hidden="true" />
            Hide
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col divide-y rounded-lg border">
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
                    "mt-px grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums sm:mt-0",
                    step.done ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
                </span>
                <div className="min-w-0">
                  <p className={cn("text-sm font-medium", step.done && "text-muted-foreground")}>
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
      </CardContent>
    </Card>
  );
}
