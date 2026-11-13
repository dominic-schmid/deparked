import type { NotifyAddress } from "@deparked/db";
import { Alert, AlertDescription } from "@deparked/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@deparked/ui/alert-dialog";
import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { Field, FieldLabel } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useId, useState } from "react";
import { PageError, PagePending } from "../../../components/page";
import { RelativeTime } from "../../../components/time";
import type { NotifyResult } from "../../../server/notify";
import {
  addNotify,
  checkNotify,
  getNotifyAddresses,
  removeNotify,
  resendNotify,
} from "../../../server/notify.functions";

export const Route = createFileRoute("/admin/_shell/settings/")({
  loader: () => getNotifyAddresses(),
  head: () => ({ meta: [{ title: "Notify addresses · Deparked" }] }),
  component: NotifyAddressesPage,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

const FAILED: NotifyResult = { ok: false, message: "That did not work. Check the connection and try again." };

function NotifyAddressesPage() {
  const { addresses, now } = Route.useLoaderData();
  const router = useRouter();
  const add = useServerFn(addNotify);
  const resend = useServerFn(resendNotify);
  const remove = useServerFn(removeNotify);
  const check = useServerFn(checkNotify);
  const [busy, setBusy] = useState<string | null>(null);
  /** The last answer, and the address row it belongs to (null: the whole list). */
  const [result, setResult] = useState<{ for: string | null; answer: NotifyResult } | null>(null);
  const [email, setEmail] = useState("");
  const emailId = useId();

  /**
   * One action at a time; whatever it answers is shown next to what it was about, and the list is read again.
   * `key` names the busy control: an address, "check" or "add".
   */
  async function run(key: string, about: string | null, action: () => Promise<NotifyResult>): Promise<boolean> {
    if (busy !== null) return false;
    setBusy(key);
    setResult(null);
    try {
      const answer = await action();
      setResult({ for: about, answer });
      await router.invalidate();
      return answer.ok;
    } catch {
      setResult({ for: about, answer: FAILED });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (await run("add", null, () => add({ data: { email } }))) setEmail("");
  }

  const listResult = result !== null && result.for === null ? result.answer : null;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Notify addresses</h2>
          </CardTitle>
          <CardDescription>
            Where offers are emailed. Cloudflare only delivers to addresses whose owner clicked the link in its
            verification email. Offers are always kept under Offers too.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {addresses.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No address yet. Add one below so offers reach your email.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {addresses.map((address) => (
                <AddressRow
                  key={address.email}
                  address={address}
                  now={now}
                  busy={busy}
                  result={result?.for === address.email ? result.answer : null}
                  onResend={() =>
                    void run(address.email, address.email, () => resend({ data: { email: address.email } }))
                  }
                  onRemove={() => void run(address.email, null, () => remove({ data: { email: address.email } }))}
                />
              ))}
            </ul>
          )}
          <div aria-live="polite">
            {listResult ? (
              <Alert variant={listResult.ok ? "default" : "destructive"}>
                <AlertDescription className="[overflow-wrap:anywhere]">{listResult.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <div>
            <Button
              variant="outline"
              aria-disabled={busy !== null}
              onClick={() => void run("check", null, () => check())}
            >
              {busy === "check" ? "Checking…" : "Check now"}
            </Button>
            <p className="mt-2 text-sm text-muted-foreground">
              Asks Cloudflare which addresses are verified. Use it after clicking a verification link.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Add an address</h2>
          </CardTitle>
          <CardDescription>Cloudflare sends it a verification email right away.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void onAdd(event)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor={emailId}>Email address</FieldLabel>
              <Input
                id={emailId}
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="email"
                spellCheck={false}
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Button type="submit" aria-disabled={busy !== null}>
              {busy === "add" ? "Sending…" : "Add address"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function AddressRow(props: {
  address: NotifyAddress;
  now: number;
  busy: string | null;
  result: NotifyResult | null;
  onResend: () => void;
  onRemove: () => void;
}) {
  const { address, now } = props;
  const verified = address.verifiedAt !== null;
  const sending = props.busy === address.email;
  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="font-medium [overflow-wrap:anywhere]" translate="no">
          {address.email}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Badge variant={verified ? "secondary" : "outline"}>{verified ? "Verified" : "Pending"}</Badge>
          {address.verifiedAt !== null ? (
            <span>
              Verified <RelativeTime time={address.verifiedAt} now={now} />
            </span>
          ) : (
            <>
              <span>
                Waiting since <RelativeTime time={address.createdAt} now={now} />
                {address.lastResentAt === null ? null : (
                  <>
                    , email sent <RelativeTime time={address.lastResentAt} now={now} />
                  </>
                )}
              </span>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {verified ? null : (
          <Button
            variant="outline"
            size="sm"
            aria-disabled={props.busy !== null}
            onClick={() => {
              if (props.busy === null) props.onResend();
            }}
          >
            {sending ? "Sending…" : "Send it again"}
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" aria-disabled={props.busy !== null}>
              Remove…
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="[overflow-wrap:anywhere]">Remove {address.email}?</AlertDialogTitle>
              <AlertDialogDescription className="[overflow-wrap:anywhere]">
                {verified
                  ? "Offers can no longer be emailed to it. Offers already received stay under Offers."
                  : "It never received an offer. A domain that would have used it moves to your other address, if you have one."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={props.onRemove}>
                Remove address
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className="basis-full empty:hidden">
        {props.result === null ? null : (
          <p
            role={props.result.ok ? "status" : "alert"}
            className={
              props.result.ok ? "text-sm [overflow-wrap:anywhere]" : "text-sm text-destructive [overflow-wrap:anywhere]"
            }
          >
            {props.result.message}
          </p>
        )}
      </div>
    </li>
  );
}
