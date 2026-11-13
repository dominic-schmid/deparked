import type { NotifyAddress } from "@deparked/db";
import { Alert } from "@deparked/ui/arc/alert";
import { Select } from "@deparked/ui/arc/select";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import type { NotifyResult } from "../server/notify";
import { pickNotify } from "../server/notify.functions";
import { SettingsSection, TEXT_LINK } from "./settings-ui";

/** Picks where a domain's offers are emailed, from the confirmed notify addresses only. */
export function NotifyPicker(props: { host: string; current: string | null; addresses: NotifyAddress[] }) {
  const router = useRouter();
  const pick = useServerFn(pickNotify);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NotifyResult | null>(null);
  const verified = props.addresses.filter((address) => address.verifiedAt !== null);
  // A pending current address (given by default) shows as picked, but cannot be picked again.
  const pendingCurrent = props.current !== null && !verified.some((address) => address.email === props.current);

  async function onPick(email: string) {
    if (email === props.current) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await pick({ data: { host: props.host, email } }));
      await router.invalidate();
    } catch {
      setResult({ ok: false, message: "That did not work. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      title="Send offers to"
      lead="Every offer is kept under Offers, and emailed to this address. Only confirmed addresses can get it."
    >
      {verified.length === 0 ? (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {props.current === null
            ? "No confirmed address yet. "
            : `Offers go to ${props.current} once it is confirmed. `}
          <Link to="/admin/settings" className={TEXT_LINK}>
            {props.current === null ? "Add an address" : "Confirm it in Settings"}
          </Link>
          .
        </p>
      ) : (
        <div className="w-full max-w-sm min-w-0 [overflow-wrap:anywhere]">
          <Select
            label="Address"
            placeholder="Pick an address"
            disabled={busy}
            {...(props.current === null ? {} : { value: props.current })}
            options={[
              ...(pendingCurrent && props.current !== null
                ? [{ value: props.current, label: `${props.current} (not confirmed yet)`, disabled: true }]
                : []),
              ...verified.map((address) => ({ value: address.email, label: address.email })),
            ]}
            onValueChange={(email) => void onPick(email)}
          />
        </div>
      )}
      <div aria-live="polite" className="empty:hidden">
        {result === null ? null : (
          <Alert tone={result.ok ? "success" : "danger"} title={result.ok ? "Saved" : "Not saved"}>
            <span className="[overflow-wrap:anywhere]">{result.message}</span>
          </Alert>
        )}
      </div>
    </SettingsSection>
  );
}
