import type { NotifyAddress } from "@deparked/db";
import { Alert, AlertDescription } from "@deparked/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { Field, FieldLabel } from "@deparked/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@deparked/ui/select";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState } from "react";
import type { NotifyResult } from "../server/notify";
import { pickNotify } from "../server/notify.functions";

const TEXT_LINK = "underline underline-offset-4";

/** Picks where a domain's offers are emailed, from the verified notify addresses only. */
export function NotifyPicker(props: { host: string; current: string | null; addresses: NotifyAddress[] }) {
  const router = useRouter();
  const pick = useServerFn(pickNotify);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NotifyResult | null>(null);
  const id = useId();
  const verified = props.addresses.filter((address) => address.verifiedAt !== null);

  async function onPick(email: string) {
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
    <Card>
      <CardHeader>
        <CardTitle>Where offers go</CardTitle>
        <CardDescription>
          Every offer is kept in the inbox, and emailed to this address. Only verified addresses can get it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {verified.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No verified address yet.{" "}
            <Link to="/admin/settings" className={TEXT_LINK}>
              Add one in Notify addresses
            </Link>
            .
          </p>
        ) : (
          <Field>
            <FieldLabel htmlFor={id}>Send offers to</FieldLabel>
            <Select value={props.current ?? undefined} onValueChange={onPick} disabled={busy}>
              <SelectTrigger id={id} className="w-full max-w-sm">
                <SelectValue placeholder="Pick an address" />
              </SelectTrigger>
              <SelectContent>
                {verified.map((address) => (
                  <SelectItem key={address.email} value={address.email}>
                    {address.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {result === null ? null : (
          <Alert variant={result.ok ? "default" : "destructive"} role={result.ok ? "status" : "alert"}>
            <AlertDescription className="[overflow-wrap:anywhere]">{result.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
