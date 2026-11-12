import type { NotifyAddress } from "@deparked/db";
import { Alert, AlertDescription } from "@deparked/ui/alert";
import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { Input } from "@deparked/ui/input";
import { Label } from "@deparked/ui/label";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, CircleAlert, MailCheck, RotateCw } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import archivo from "../../../../install/public/fonts/archivo-latin.woff2?url";
import newsreader from "../../../../install/public/fonts/newsreader-latin.woff2?url";
import { DomainPicker } from "../../components/add-domain";
import { OnboardingShell, Screen, ScreenTitle, Spinner } from "../../components/onboarding";
import { PageError } from "../../components/page";
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
    links: [archivo, newsreader].map((href) => ({
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

const BUTTON = "h-11 px-5";

const NOT_YET: NotifyResult = { ok: true, message: "" };

function WelcomePage() {
  const data = Route.useLoaderData();
  return (
    <OnboardingShell stage={data.screen === "domain" ? "Domain" : "Offers"}>
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
      <div id={props.id} role="alert" className="mt-4">
        <CredentialsRejected message={props.result.message} />
      </div>
    );
  }
  return (
    <div id={props.id} role="alert" className="mt-2.5 flex gap-2 text-sm">
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

function LaterLink() {
  return (
    <p className="mt-10 border-t pt-6 text-sm text-muted-foreground">
      Not now?{" "}
      <Link
        to="/admin"
        className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        Skip to the admin
      </Link>
      . You can add an address any time in Settings. Until then offers wait in the inbox.
    </p>
  );
}

const emailSchema = z.email().max(254);

/** Step "Where should offers go?": one address, which gets Cloudflare's verification email. */
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
    <>
      <ScreenTitle eyebrow="Your password is set" title="Where should offers go?">
        <p>
          When someone makes an offer for one of your domains, Deparked emails it to you. Cloudflare delivers only to
          addresses that confirmed a verification email, so it sends one as soon as you add yours.
        </p>
      </ScreenTitle>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex max-w-xl flex-col gap-4">
        <div>
          <Label htmlFor={id} className="mb-2 text-sm font-medium">
            Email address
          </Label>
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
            className="h-11 text-[15px] sm:text-sm"
          />
          <p id={hintId} className="mt-2 text-[13px] text-muted-foreground">
            Only you see it. Buyers never do: they send offers through the form on your page.
          </p>
          <Problem result={result} id={errorId} />
        </div>
        <div>
          <Button type="submit" size="lg" className={BUTTON} aria-disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? "Sending…" : "Send verification email"}
          </Button>
        </div>
      </form>
      <LaterLink />
    </>
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

  return (
    <>
      <ScreenTitle
        eyebrow={pending.length === 0 ? "Address verified" : "Verification email sent"}
        title={pending.length === 0 ? "Offers will reach you" : "Check your inbox"}
      >
        {pending.length === 0 ? (
          <p>Cloudflare confirmed your address. Every offer is emailed there and also kept in your Deparked inbox.</p>
        ) : (
          <p>
            Cloudflare sent an email with a verification link. Click it, then come back and check. No need to wait: you
            can go on now, and offers are kept in your Deparked inbox until the address is verified.
          </p>
        )}
      </ScreenTitle>

      <ul className="max-w-xl divide-y rounded-xl border bg-card">
        {props.addresses.map((address) => {
          const verified = address.verifiedAt !== null;
          return (
            <li key={address.email} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 sm:p-5">
              <span className="flex min-w-0 items-start gap-3">
                <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]" translate="no">
                  {address.email}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge variant={verified ? "secondary" : "outline"}>{verified ? "Verified" : "Pending"}</Badge>
                {verified ? null : (
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

      {pending.length > 0 ? (
        <div className="mt-4 flex max-w-xl flex-wrap gap-3">
          <Button variant="outline" aria-disabled={busy !== null} onClick={() => void run("check", () => check())}>
            {busy === "check" ? <Spinner /> : <RotateCw aria-hidden />}
            {busy === "check" ? "Checking…" : "I clicked the link"}
          </Button>
        </div>
      ) : null}
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
            <p className="mt-4 text-sm">
              Not verified yet. Open the newest email from Cloudflare, click its link, then check again.
            </p>
          ) : null
        ) : result?.ok ? (
          <Alert className="mt-4">
            <AlertDescription className="[overflow-wrap:anywhere]">{result.message}</AlertDescription>
          </Alert>
        ) : (
          <Problem result={result} />
        )}
      </div>
      {pending.length > 0 ? (
        <p className="mt-4 max-w-xl text-[13px] text-muted-foreground">
          Nothing arrived? Look in the spam folder. The email comes from Cloudflare, not from Deparked.
        </p>
      ) : null}

      <div className="mt-10">
        <Button
          ref={next}
          size="lg"
          className={BUTTON}
          onClick={() => void navigate({ to: "/admin/welcome", search: { step: "domain" } })}
        >
          Next: add a domain <ArrowRight aria-hidden />
        </Button>
      </div>
    </>
  );
}

/** Step "Add your first domain, or skip": the zone picker of "+ Add domain"; a pick continues in that flow. */
function DomainScreen(props: { addresses: NotifyAddress[] }) {
  const address = defaultNotifyAddress(props.addresses);
  return (
    <>
      <ScreenTitle eyebrow="Last step" title="Add your first domain">
        <p>
          It gets a for-sale page and an offer form. You can turn Deparked off on it again at any time. Not ready?{" "}
          <Link
            to="/admin"
            className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Skip this for now
          </Link>
          .
        </p>
      </ScreenTitle>
      <p className="mb-6 flex max-w-2xl gap-3 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <MailCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {address === null ? (
            "Its offers wait in the inbox until one of your addresses is verified. The first one verified gets them."
          ) : (
            <>
              Offers for it go to{" "}
              <span className="font-medium text-foreground" translate="no">
                {address.email}
              </span>
              {address.verifiedAt === null ? ", once you have clicked the link in Cloudflare's email." : "."} You can
              pick another address on the domain's settings later.
            </>
          )}
        </span>
      </p>
      <DomainPicker />
      <div className="mt-10 flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="ghost" className="self-start">
          <Link to="/admin/welcome" search={{}}>
            <ArrowLeft aria-hidden /> Back
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className={BUTTON}>
          <Link to="/admin">Skip for now</Link>
        </Button>
      </div>
    </>
  );
}
