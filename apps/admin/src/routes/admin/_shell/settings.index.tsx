import type { NotifyAddress } from "@deparked/db";
import { Alert } from "@deparked/ui/arc/alert";
import { EmptyState } from "@deparked/ui/arc/empty-state";
import { Button } from "@deparked/ui/button";
import { Disclosure } from "@deparked/ui/flow";
import { Input } from "@deparked/ui/input";
import { cn } from "@deparked/ui/lib/utils";
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Clock, MailPlus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ConfirmDialog } from "../../../components/confirm-dialog";
import { SettingsSection } from "../../../components/settings-ui";
import { RelativeTime } from "../../../components/time";
import type { NotifyResult } from "../../../server/notify";
import { addNotify, checkNotify, removeNotify, resendNotify } from "../../../server/notify.functions";

const settingsRoute = getRouteApi("/admin/_shell/settings");

export const Route = createFileRoute("/admin/_shell/settings/")({
  // `section=offers` opens this section as its own page on a phone; on a wide screen it changes nothing.
  validateSearch: (search): { section?: "offers" | undefined } => ({
    section: search.section === "offers" ? "offers" : undefined,
  }),
  head: () => ({ meta: [{ title: "Where offers go · Deparked" }] }),
  component: NotifyAddressesPage,
});

const FAILED: NotifyResult = { ok: false, message: "That did not work. Check the connection and try again." };

function NotifyAddressesPage() {
  const { addresses, now } = settingsRoute.useLoaderData().notify;
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
   * `key` names the busy control: "<action>:<address>" or "add".
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
    <SettingsSection title="Where offers go" lead="Every offer is emailed here and kept under Offers.">
      {addresses.length === 0 ? (
        <EmptyState
          icon={<MailPlus width={24} height={24} strokeWidth={1.75} />}
          title="Offers are not emailed yet"
          description="Add the address offers should go to. Until then every offer is kept under Offers."
          className="rounded-[20px] bg-background"
        />
      ) : (
        <ul aria-label="Addresses" className="flex flex-col gap-2">
          {addresses.map((address) => (
            <AddressRow
              key={address.email}
              address={address}
              now={now}
              busy={busy}
              result={result?.for === address.email ? result.answer : null}
              onCheck={() => void run(`check:${address.email}`, address.email, () => check())}
              onResend={() =>
                void run(`resend:${address.email}`, address.email, () => resend({ data: { email: address.email } }))
              }
              onRemove={() => run(`remove:${address.email}`, null, () => remove({ data: { email: address.email } }))}
            />
          ))}
        </ul>
      )}

      <Disclosure summary="Why an address needs confirming">
        <p>
          Cloudflare only delivers to addresses whose owner clicked the link in its verification email. Adding an
          address sends that email right away; once you clicked the link, press “I clicked it” and Deparked asks
          Cloudflare again.
        </p>
        <p>Offers are always kept under Offers too, so none is lost while an address waits.</p>
      </Disclosure>

      <form onSubmit={(event) => void onAdd(event)} className="flex flex-col gap-2 border-t pt-6">
        <label htmlFor={emailId} className="text-sm font-semibold">
          {addresses.length === 0 ? "Add an address" : "Add another address"}
        </label>
        <div className="flex flex-wrap gap-2">
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
            className="min-w-0 flex-[1_1_14rem]"
          />
          <Button type="submit" variant="accent" aria-disabled={busy !== null} className="max-sm:w-full">
            {busy === "add" ? "Sending…" : "Add address"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Cloudflare sends it a verification email right away.</p>
      </form>

      <div aria-live="polite" className="empty:hidden">
        {listResult === null ? null : (
          <Alert tone={listResult.ok ? "success" : "danger"} title={listResult.ok ? "Done" : "That did not work"}>
            <span className="[overflow-wrap:anywhere]">{listResult.message}</span>
          </Alert>
        )}
      </div>
    </SettingsSection>
  );
}

function AddressRow(props: {
  address: NotifyAddress;
  now: number;
  busy: string | null;
  result: NotifyResult | null;
  onCheck: () => void;
  onResend: () => void;
  onRemove: () => Promise<boolean>;
}) {
  const { address, now, busy } = props;
  const [confirming, setConfirming] = useState(false);
  const verified = address.verifiedAt !== null;
  const doing = (action: string) => busy === `${action}:${address.email}`;
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-2xl px-4 py-3.5",
        verified ? "bg-background" : "bg-caution/15",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          verified ? "bg-positive/15 text-[color:var(--success)]" : "bg-caution text-tangerine-foreground",
        )}
      >
        {verified ? <Check className="size-4" strokeWidth={2.8} /> : <Clock className="size-4" strokeWidth={2.4} />}
      </span>
      <span className="flex min-w-0 flex-[1_1_12rem] flex-col">
        <span className="font-semibold [overflow-wrap:anywhere]" translate="no">
          {address.email}
        </span>
        <span className="text-[13.5px] text-muted-foreground">
          {address.verifiedAt !== null ? (
            <>
              Confirmed <RelativeTime time={address.verifiedAt} now={now} />
            </>
          ) : (
            <>
              Waiting for you to click the link in its inbox · sent{" "}
              <RelativeTime time={address.lastResentAt ?? address.createdAt} now={now} />
            </>
          )}
        </span>
      </span>
      <span className={cn("flex flex-wrap items-center gap-1.5", !verified && "max-sm:w-full")}>
        {verified ? null : (
          <>
            <Button size="sm" aria-disabled={busy !== null} onClick={() => busy === null && props.onCheck()}>
              {doing("check") ? "Checking…" : "I clicked it"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-disabled={busy !== null}
              onClick={() => busy === null && props.onResend()}
            >
              {doing("resend") ? "Sending…" : "Send it again"}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-disabled={busy !== null}
          aria-label={`Remove ${address.email}…`}
          onClick={() => busy === null && setConfirming(true)}
        >
          {doing("remove") ? "Removing…" : "Remove…"}
        </Button>
      </span>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove ${address.email}?`}
        description={
          verified
            ? "Offers can no longer be emailed to it. Offers already received stay under Offers."
            : "It never received an offer. A domain that would have used it moves to your other address, if you have one."
        }
        cancel="Keep it"
        confirm="Remove address"
        tone="danger"
        onConfirm={() => {
          setConfirming(false);
          void props.onRemove();
        }}
      />
      {props.result === null ? null : (
        <p
          role={props.result.ok ? "status" : "alert"}
          className={cn(
            "basis-full text-sm [overflow-wrap:anywhere]",
            props.result.ok ? "text-foreground" : "text-destructive",
          )}
        >
          {props.result.message}
        </p>
      )}
    </li>
  );
}
