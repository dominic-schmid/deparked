import type { TokenHealth } from "@deparked/hosting";
import { Alert, AlertDescription, AlertTitle } from "@deparked/ui/alert";
import { Badge } from "@deparked/ui/badge";
import { Button } from "@deparked/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { Field, FieldDescription, FieldLabel } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useId, useState } from "react";
import { PageError, PagePending } from "../../../components/page";
import { getTokenHealth, replaceToken } from "../../../server/hub/functions";
import { tokenSchema } from "../../../server/hub/hub";

export const Route = createFileRoute("/admin/_shell/settings/cloudflare")({
  loader: () => getTokenHealth(),
  head: () => ({ meta: [{ title: "Cloudflare token · Deparked" }] }),
  component: CloudflarePage,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

const STATE: Record<TokenHealth["state"], { label: string; tone: "default" | "destructive" | "outline" }> = {
  ok: { label: "Works", tone: "default" },
  incomplete: { label: "Missing permissions", tone: "destructive" },
  rejected: { label: "Rejected by Cloudflare", tone: "destructive" },
};

function Health({ health }: { health: TokenHealth }) {
  const state = STATE[health.state];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Saved token:</span>
        <Badge variant={state.tone}>{state.label}</Badge>
      </div>
      {health.state === "rejected" ? (
        <p className="text-sm">
          Cloudflare no longer accepts it: it was deleted, expired or disabled. Your pages stay online; publishing and
          domain changes stop until you paste a new token below.
        </p>
      ) : null}
      {health.missing.length > 0 ? (
        <div className="text-sm">
          <p>It lacks these permissions:</p>
          <ul className="mt-1 list-disc pl-5">
            {health.missing.map((gap) => (
              <li key={gap.label}>
                <span className="font-medium">{gap.label}</span>: {gap.why}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {health.unchecked.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Not checked until you add a domain: {health.unchecked.map((gap) => gap.label).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

function CloudflarePage() {
  const loaded = Route.useLoaderData();
  const router = useRouter();
  const replace = useServerFn(replaceToken);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const tokenId = useId();
  const helpId = useId();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = tokenSchema.safeParse({ token });
    if (!parsed.success) {
      setResult({ ok: false, message: parsed.error.issues[0]?.message ?? "That is not a token." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const answer = await replace({ data: parsed.data });
      if (answer.ok && answer.value.ok) {
        setToken("");
        setResult({
          ok: true,
          message:
            "The new token is saved. Deparked switches to it within about a minute; until then it may still use the old one.",
        });
        await router.invalidate();
      } else {
        setResult({ ok: false, message: answer.ok ? (answer.value.ok ? "" : answer.value.message) : answer.message });
      }
    } catch {
      setResult({ ok: false, message: "That did not work. Check the token and the connection, then try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Cloudflare token</CardTitle>
          <CardDescription>
            Deparked publishes your pages and sets up domains with the API token you pasted during the install. It is
            stored only as a secret of the admin panel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loaded.ok ? (
            <Health health={loaded.value} />
          ) : (
            <Alert variant="destructive">
              <AlertDescription>{loaded.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Replace token</CardTitle>
          <CardDescription>
            Create a new token on Cloudflare's token page with the same permissions, in the same account, and paste it
            here. Deparked checks it before saving it; the old one keeps working until then. Delete the old token on
            Cloudflare afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={tokenId}>New API token</FieldLabel>
              <Input
                id={tokenId}
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
                aria-describedby={helpId}
              />
              <FieldDescription id={helpId}>It is never shown again, here or anywhere else.</FieldDescription>
            </Field>
            <div>
              <Button type="submit" aria-disabled={busy}>
                {busy ? "Checking…" : "Check and save"}
              </Button>
            </div>
            {result === null ? null : (
              <Alert variant={result.ok ? "default" : "destructive"} role={result.ok ? "status" : "alert"}>
                <AlertTitle>{result.ok ? "Token replaced" : "Not saved"}</AlertTitle>
                <AlertDescription className="[overflow-wrap:anywhere]">{result.message}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
