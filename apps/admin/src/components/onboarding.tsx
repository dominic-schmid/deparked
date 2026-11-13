import { FlowFrame } from "@deparked/ui/flow";
import { cn } from "@deparked/ui/lib/utils";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { UntilHydrated } from "./hydrated";

// The first run after the installer: the same frame as the installer's screens (`@deparked/ui/flow`), here with the
// admin's three stages.

export const STAGES = ["Password", "Offers", "First domain"] as const;
export type Stage = (typeof STAGES)[number];

function Frame(props: { stage: Stage; footer: ReactNode; children: ReactNode }) {
  return (
    <FlowFrame
      steps={STAGES}
      current={STAGES.indexOf(props.stage)}
      stepsLabel="Setup progress"
      skipLabel="Skip to the setup"
      footer={props.footer}
    >
      {props.children}
    </FlowFrame>
  );
}

const NOTE = <span>Deparked runs in your Cloudflare account. No server of ours is involved.</span>;

/** The password step: a plain form post that works before and without JavaScript, so nothing waits for hydration. */
export function SetupShell(props: { children: ReactNode }) {
  return (
    <Frame stage="Password" footer={NOTE}>
      {props.children}
    </Frame>
  );
}

/** The steps after the password: they run on server functions, so controls wait for hydration (`UntilHydrated`). */
export function OnboardingShell(props: { stage: Stage; children: ReactNode }) {
  return (
    <UntilHydrated>
      <Frame
        stage={props.stage}
        footer={
          <>
            {NOTE}
            <form method="post" action="/admin/logout">
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Log out
              </button>
            </form>
          </>
        }
      >
        {props.children}
      </Frame>
    </UntilHydrated>
  );
}

export function Spinner(props: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn("onboarding-spin size-4", props.className)} />;
}

/** A screen arrives once with a short rise (none under reduced motion); later re-renders stay still. */
export function Screen(props: { children: ReactNode }) {
  return <div className="onboarding-in">{props.children}</div>;
}

/**
 * Two columns on a wide screen, the question beside its picture; one column on a phone, the question first unless
 * the picture is small and explains the question (`pictureFirst`).
 */
export function Split(props: { children: ReactNode; picture: ReactNode; pictureFirst?: boolean; className?: string }) {
  return (
    <div
      className={cn("grid items-center gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", props.className)}
    >
      <div className="flex min-w-0 flex-col gap-7">{props.children}</div>
      <div className={cn("min-w-0", props.pictureFirst === true && "max-lg:order-first")}>{props.picture}</div>
    </div>
  );
}
