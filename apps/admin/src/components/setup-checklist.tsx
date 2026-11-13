import { OnboardingChecklist, type OnboardingStep } from "@deparked/ui/arc/onboarding-checklist";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { dismissSetupChecklist } from "../server/domains.functions";
import { checkNotify } from "../server/notify.functions";
import type { ChecklistStepId, SetupChecklist } from "../server/setup-checklist";

const NOT_VERIFIED = "Not verified yet. Click the link in the newest email from Cloudflare.";

/**
 * "Finish setting up" on the home screen: the four steps of a working install, each with its real state and the one
 * action that does it. Arc's onboarding checklist. Hiding it hides it for good (it stays gone after a reload);
 * Settings and Add a domain still reach everything.
 */
export function SetupChecklistCard({ checklist }: { checklist: SetupChecklist }) {
  const router = useRouter();
  const navigate = useNavigate();
  const dismiss = useServerFn(dismissSetupChecklist);
  const check = useServerFn(checkNotify);
  const done = new Map(checklist.steps.map((step) => [step.id, step.done]));
  const { email, host } = checklist;

  const steps: Record<ChecklistStepId, OnboardingStep> = {
    address: {
      id: "address",
      title: "Add an address for offers",
      description:
        done.get("address") && email !== null
          ? `Offers go to ${email}.`
          : "Offers are kept here, and emailed once an address is verified.",
      actionLabel: "Add an address",
      onAction: () => navigate({ to: "/admin/settings" }),
    },
    verify: {
      id: "verify",
      title: "Verify the address",
      description:
        email === null
          ? "Cloudflare emails a link to the address you add. Click it once."
          : done.get("verify")
            ? `${email} is verified.`
            : `Click the link in Cloudflare's email to ${email}.`,
      ...(email === null
        ? {}
        : {
            actionLabel: "Check again",
            // A verified address re-renders the checklist with the step done (see the key below); anything else stays
            // open with the reason.
            onAction: async () => {
              let message: string;
              try {
                const result = await check();
                await router.invalidate();
                message = result.ok ? NOT_VERIFIED : result.message;
              } catch {
                message = "The admin did not answer. Check the connection and try again.";
              }
              throw new Error(message);
            },
          }),
    },
    domain: {
      id: "domain",
      title: "Add your first domain",
      description:
        done.get("domain") && host !== null
          ? `${host} is added.`
          : "Pick one from your Cloudflare account. Nothing changes before you say yes.",
      actionLabel: "Choose a domain",
      onAction: () => navigate({ to: "/admin/add" }),
    },
    publish: {
      id: "publish",
      title: "Publish its design",
      description:
        host === null
          ? "Choose a design and wording, then publish it."
          : done.get("publish")
            ? "A design is live."
            : `${host} shows a placeholder until you publish a design.`,
      ...(host === null
        ? {}
        : { actionLabel: "Open the editor", onAction: () => navigate({ to: "/admin/d/$host", params: { host } }) }),
    },
  };

  const completed = checklist.steps.filter((step) => step.done).map((step) => step.id);
  return (
    <OnboardingChecklist
      // The checklist keeps its own state after the first render: a step the server now reports done starts it over.
      key={completed.join()}
      title="Finish setting up"
      steps={checklist.steps.map((step) => steps[step.id])}
      defaultCompleted={completed}
      onHiddenChange={async (hidden) => {
        if (!hidden) return;
        try {
          await dismiss();
        } finally {
          await router.invalidate();
        }
      }}
      className="w-full max-w-2xl border-transparent shadow-lift"
    />
  );
}
