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
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NotifyResult | null>(null);
  const [email, setEmail] = useState("");
  const emailId = useId();

  /** One action at a time; whatever it answers is shown, and the list is read again. */
  async function run(action: () => Promise<NotifyResult>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setResult(null);
    try {
      const answer = await action();
      setResult(answer);
      await router.invalidate();
      return answer.ok;
    } catch {
      setResult(FAILED);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (await run(() => add({ data: { email } }))) setEmail("");
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Notify addresses</h2>
          </CardTitle>
          <CardDescription>
            Where offers are emailed. Cloudflare only delivers to addresses whose owner clicked the link in its
            verification email. Offers are always kept in the inbox too.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {addresses.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No address yet. Add one below so offers reach your inbox.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {addresses.map((address) => (
                <AddressRow
                  key={address.email}
                  address={address}
                  now={now}
                  busy={busy}
                  onResend={() => void run(() => resend({ data: { email: address.email } }))}
                  onRemove={() => void run(() => remove({ data: { email: address.email } }))}
                />
              ))}
            </ul>
          )}
          <div aria-live="polite">
            {result ? (
              <Alert variant={result.ok ? "default" : "destructive"}>
                <AlertDescription className="[overflow-wrap:anywhere]">{result.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <div>
            <Button variant="outline" aria-disabled={busy} onClick={() => void run(() => check())}>
              {busy ? "Working…" : "Check now"}
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
            <Button type="submit" aria-disabled={busy}>
              Add address
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
  busy: boolean;
  onResend: () => void;
  onRemove: () => void;
}) {
  const { address } = props;
  const verified = address.verifiedAt !== null;
  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium [overflow-wrap:anywhere]">{address.email}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={verified ? "secondary" : "outline"}>{verified ? "Verified" : "Pending"}</Badge>
          {address.lastResentAt !== null && !verified ? (
            <span>
              Email sent again <RelativeTime time={address.lastResentAt} now={props.now} />
            </span>
          ) : (
            <span>
              Added <RelativeTime time={address.createdAt} now={props.now} />
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {verified ? null : (
          <Button
            variant="outline"
            size="sm"
            aria-disabled={props.busy}
            onClick={() => {
              if (!props.busy) props.onResend();
            }}
          >
            Resend email
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" aria-disabled={props.busy}>
              Remove
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this address?</AlertDialogTitle>
              <AlertDialogDescription className="[overflow-wrap:anywhere]">
                Offers can no longer be emailed to {address.email}. Offers already received stay in the inbox.
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
    </li>
  );
}
