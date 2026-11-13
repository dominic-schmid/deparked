import type { NotifyAddress } from "@deparked/db";
import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { Disclosure, FlowTitle } from "@deparked/ui/flow";
import { Input } from "@deparked/ui/input";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, CircleAlert, Lock, MailCheck, RotateCw } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import display from "../../../../install/public/fonts/bricolage-grotesque-latin.woff2?url";
import body from "../../../../install/public/fonts/instrument-sans-latin.woff2?url";
import { DomainPicker } from "../../components/add-domain";
import { OnboardingShell, Screen, Spinner, Split } from "../../components/onboarding";
import { PageError } from "../../components/page";
import { OfferPath } from "../../components/pictures";
import { CredentialsRejected } from "../../components/setup-runner";
import type { NotifyResult } from "../../server/notify";
import { addNotify, checkNotify, resendNotify } from "../../server/notify.functions";
import { defaultNotifyAddress } from "../../server/notify-default";
import { getOnboarding } from "../../server/onboarding.functions";

// The first-run wizard after the password (decision doc section 13, steps 5 and 6). Which screen shows is derived
// from the data on every load (see `onboardingScreen`), so a reload resumes it.
export const Route = createFileRoute("/admin/welcome")({
  validateSearch: (search): { step?: "domain" | undefined } => ({
    step: search.step === "domain" ? "domain" : undefined,
  }),
  loaderDeps: ({ search }) => ({ wantsDomainStep: search.step === "domain" }),
  loader: ({ deps }) => getOnboarding({ data: deps }),
  staleTime: 0,
  head: () => ({
    meta: [{ title: "Set up Deparked · Deparked" }],
    links: [body, display].map((href) => ({
      rel: "preload",
      as: "font",
      type: "font/woff2",
      href,
      crossOrigin: "anonymous" as const,
    })),
  }),
  component: WelcomePage,
  errorComponent: () => (
    <OnboardingShell stage="Offers">
      <PageError />
    </OnboardingShell>
  ),
});

const FAILED: NotifyResult = {
  ok: false,
  message: "The admin did not answer. Check your connection and try again.",
};

const NOT_YET: NotifyResult = { ok: true, message: "" };

const TEXT_LINK =
  "inline-flex min-h-11 items-center rounded-sm text-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

function WelcomePage() {
  const data = Route.useLoaderData();
  return (
    <OnboardingShell stage={data.screen === "domain" ? "First domain" : "Offers"}>
      <Screen key={data.screen}>
        {data.screen === "notify" ? <NotifyScreen /> : null}
        {data.screen === "inbox" ? <InboxScreen addresses={data.addresses} /> : null}
        {data.screen === "domain" ? <DomainScreen addresses={data.addresses} /> : null}
      </Screen>
    </OnboardingShell>
  );
}

function Problem(props: { result: NotifyResult | null; id?: string }) {
  if (props.result === null || props.result.ok) return null;
  if (props.result.credentialsRejected) {
    return (
      <div id={props.id} role="alert">
        <CredentialsRejected message={props.result.message} />
      </div>
    );
  }
  return (
    <div id={props.id} role="alert" className="flex gap-2 text-sm">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="text-destructive [overflow-wrap:anywhere]">{props.result.message}</p>
        {props.result.detail === undefined ? null : (
          <p className="mt-1 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
            Cloudflare said: {props.result.detail}
          </p>
        )}
      </div>
    </div>
  );
}

/** "Why confirm it?" and "Skip for now": the detail behind the question, and the way past it. */
function WhyAndSkip() {
  return (
    <div className="flex flex-wrap items-start gap-x-6">
      <Disclosure summary="Why do I have to confirm it?">
        <p>
          Cloudflare sends the offer emails, and it delivers only to addresses that clicked the link in its verification
          email. It sends that email as soon as you add your address.
        </p>
        <p>Skip this, and offers wait under Offers until you add an address in Settings.</p>
      </Disclosure>
      <Link to="/admin" className={TEXT_LINK}>
        Skip for now
      </Link>
    </div>
  );
}

const emailSchema = z.email().max(254);

/** Step "Where should offers land?": one address, which gets Cloudflare's verification email. */
function NotifyScreen() {
  const router = useRouter();
  const add = useServerFn(addNotify);
  const id = useId();
  const hintId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NotifyResult | null>(null);

  useEffect(() => {
    if (result !== null && !result.ok) input.current?.focus();
  }, [result]);

  // Uncontrolled: what the owner typed before the page hydrated survives hydration.
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const value = String(new FormData(event.currentTarget).get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!emailSchema.safeParse(value).success) {
      setResult({
        ok: false,
        message:
          value === ""
            ? "Enter the email address that should get the offers."
            : "That does not look like an email address. Check it for typos.",
      });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const answer = await add({ data: { email: value } });
      if (answer.ok) await router.invalidate();
      else setResult(answer);
    } catch {
      setResult(FAILED);
    } finally {
      setBusy(false);
    }
  }

  const invalid = result !== null && !result.ok;
  return (
    <Split picture={<OfferPath state="ask" />}>
      <FlowTitle title="Where should offers land?">
        <p>Every offer is emailed to you and kept here.</p>
      </FlowTitle>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex max-w-[30rem] flex-col gap-2.5">
        <label htmlFor={id} className="text-sm font-semibold">
          Email address
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            ref={input}
            id={id}
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            placeholder="you@example.com"
            defaultValue=""
            aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
            aria-invalid={invalid ? true : undefined}
            className="h-12 min-w-0 flex-[1_1_14rem] text-[17px]"
          />
          <Button type="submit" variant="accent" size="lg" className="h-12 px-6 max-sm:w-full" aria-disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? "Sending…" : "Send verification email"}
          </Button>
        </div>
        <p id={hintId} className="flex items-center gap-1.5 text-[13.5px] text-muted-foreground">
          <Lock aria-hidden className="size-3.5 shrink-0" />
          Buyers never see it.
        </p>
        <Problem result={result} id={errorId} />
      </form>
      <WhyAndSkip />
    </Split>
  );
}

/** "Check your inbox": the address is pending until its owner clicks Cloudflare's link. The owner may go on. */
function InboxScreen(props: { addresses: NotifyAddress[] }) {
  const router = useRouter();
  const navigate = useNavigate();
  const resend = useServerFn(resendNotify);
  const check = useServerFn(checkNotify);
  /** "check", or the address whose mail is being sent again. */
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<NotifyResult | null>(null);
  const pending = props.addresses.filter((address) => address.verifiedAt === null);
  const next = useRef<HTMLButtonElement>(null);
  const wasPending = useRef(pending.length > 0);
  const [verifiedNote, setVerifiedNote] = useState(false);

  // The pending buttons unmount when the address is verified: say so, and keep focus from falling to <body>.
  useEffect(() => {
    if (wasPending.current && pending.length === 0) {
      setVerifiedNote(true);
      next.current?.focus();
    }
    wasPending.current = pending.length > 0;
  }, [pending.length]);

  async function run(kind: string, action: () => Promise<NotifyResult>) {
    if (busy !== null) return;
    setBusy(kind);
    setResult(null);
    try {
      const answer = await action();
      // A successful check speaks through the badge and the heading; only "still pending" needs words.
      setResult(kind === "check" && answer.ok ? NOT_YET : answer);
      await router.invalidate();
    } catch {
      setResult(FAILED);
    } finally {
      setBusy(null);
    }
  }

  const verified = pending.length === 0;
  return (
    <Split picture={<OfferPath state={verified ? "verified" : "pending"} />}>
      <FlowTitle title={verified ? "Offers will reach you" : "Check your inbox"}>
        <p>
          {verified
            ? "Cloudflare confirmed your address. Every offer is emailed there and kept here."
            : "Click the link in Cloudflare's email, then come back here."}
        </p>
      </FlowTitle>

      <div className="flex flex-col gap-3">
        <ul className="flex max-w-xl flex-col gap-2">
          {props.addresses.map((address) => {
            const isVerified = address.verifiedAt !== null;
            return (
              <li
                key={address.email}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl bg-card p-3 pl-4 shadow-rest"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <MailCheck aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]" translate="no">
                    {address.email}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={isVerified ? "secondary" : "outline"}>{isVerified ? "Verified" : "Pending"}</Badge>
                  {isVerified ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-disabled={busy !== null}
                      onClick={() => void run(address.email, () => resend({ data: { email: address.email } }))}
                    >
                      {busy === address.email ? <Spinner /> : null}
                      {busy === address.email ? "Sending…" : "Send it again"}
                      <span className="sr-only"> to {address.email}</span>
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <div aria-live="polite" className="max-w-xl">
          <p className="sr-only">
            {busy === "check"
              ? "Checking…"
              : busy !== null
                ? "Sending…"
                : verifiedNote
                  ? "Your address is verified."
                  : ""}
          </p>
          {result === NOT_YET ? (
            pending.length > 0 ? (
              <p className="text-sm">
                Not verified yet. Open the newest email from Cloudflare, click its link, then check again.
              </p>
            ) : null
          ) : result?.ok ? (
            <p className="text-sm [overflow-wrap:anywhere]">{result.message}</p>
          ) : (
            <Problem result={result} />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          ref={next}
          variant="accent"
          size="lg"
          className="h-12 px-6"
          onClick={() => void navigate({ to: "/admin/welcome", search: { step: "domain" } })}
        >
          Next: add a domain <ArrowRight aria-hidden />
        </Button>
        {verified ? null : (
          <Button
            variant="outline"
            size="lg"
            className="h-12"
            aria-disabled={busy !== null}
            onClick={() => void run("check", () => check())}
          >
            {busy === "check" ? <Spinner /> : <RotateCw aria-hidden />}
            {busy === "check" ? "Checking…" : "I clicked the link"}
          </Button>
        )}
      </div>

      {verified ? null : (
        <Disclosure summary="Nothing arrived?">
          <p>Look in the spam folder. The email comes from Cloudflare, not from Deparked.</p>
          <p>No need to wait: go on now. Offers are kept under Offers until the address is verified.</p>
        </Disclosure>
      )}
    </Split>
  );
}

/** Step "Add your first domain, or skip": the zone picker of "+ Add domain"; a pick continues in that flow. */
function DomainScreen(props: { addresses: NotifyAddress[] }) {
  const address = defaultNotifyAddress(props.addresses);
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <FlowTitle title="Add your first domain">
        <p>Pick one from your Cloudflare account. It gets a for-sale page, and turning it off undoes it.</p>
      </FlowTitle>
      <p className="flex max-w-2xl items-start gap-3 text-sm text-muted-foreground">
        <MailCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {address === null ? (
            "Its offers wait under Offers until one of your addresses is verified."
          ) : (
            <>
              Offers for it go to{" "}
              <span className="font-medium text-foreground" translate="no">
                {address.email}
              </span>
              {address.verifiedAt === null ? ", once you have clicked the link in Cloudflare's email." : "."}
            </>
          )}
        </span>
      </p>
      <DomainPicker />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
        <Button asChild variant="ghost" className="min-h-11">
          <Link to="/admin/welcome" search={{}}>
            <ArrowLeft aria-hidden /> Back
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="h-12">
          <Link to="/admin">Skip for now</Link>
        </Button>
      </div>
    </div>
  );
}
