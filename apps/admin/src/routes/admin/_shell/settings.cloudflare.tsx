import type { TokenHealth } from "@deparked/hosting";
import { Alert } from "@deparked/ui/arc/alert";
import { Button } from "@deparked/ui/button";
import { Disclosure } from "@deparked/ui/flow";
import { Input } from "@deparked/ui/input";
import { cn } from "@deparked/ui/lib/utils";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, CircleX, type LucideIcon, TriangleAlert, X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { PageError, PagePending } from "../../../components/page";
import { IconRows, SectionPart, SettingsSection } from "../../../components/settings-ui";
import { getTokenHealth, replaceToken } from "../../../server/hub/functions";
import { tokenSchema } from "../../../server/hub/hub";

export const Route = createFileRoute("/admin/_shell/settings/cloudflare")({
  loader: () => getTokenHealth(),
  head: () => ({ meta: [{ title: "Cloudflare connection · Deparked" }] }),
  component: CloudflarePage,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

const STATE: Record<
  TokenHealth["state"],
  { label: string; line: string; icon: LucideIcon; look: string; tint: string }
> = {
  ok: {
    label: "Works",
    line: "Deparked can publish your pages and set up domains.",
    icon: Check,
    look: "bg-positive/15 text-[color:var(--success)]",
    tint: "bg-background",
  },
  incomplete: {
    label: "Missing permissions",
    line: "Some changes stop until the token has every permission below.",
    icon: TriangleAlert,
    look: "bg-caution text-tangerine-foreground",
    tint: "bg-caution/15",
  },
  rejected: {
    label: "Rejected by Cloudflare",
    line: "Cloudflare no longer accepts it: it was deleted, expired or disabled. Your pages stay online; publishing and domain changes stop until you paste a new token below.",
    icon: CircleX,
    look: "bg-destructive text-primary-foreground dark:text-tangerine-foreground",
    tint: "bg-destructive/10",
  },
};

function Health({ health }: { health: TokenHealth }) {
  const state = STATE[health.state];
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("flex items-start gap-3.5 rounded-2xl px-4 py-3.5", state.tint)}>
        <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-full", state.look)}>
          <state.icon className="size-4" strokeWidth={2.6} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm text-muted-foreground">Saved token</span>
          <span className="font-semibold">{state.label}</span>
          <span className="mt-0.5 text-sm text-muted-foreground">{state.line}</span>
        </span>
      </div>
      {health.missing.length > 0 ? (
        <IconRows
          label="Missing permissions"
          rows={health.missing.map((gap) => ({
            key: gap.label,
            icon: X,
            tone: "danger" as const,
            text: (
              <>
                <span className="font-medium">{gap.label}</span>: {gap.why}
              </>
            ),
          }))}
        />
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
    <SettingsSection
      title="Cloudflare connection"
      lead="Deparked publishes your pages and sets up domains with the API token you pasted during the install."
    >
      {loaded.ok ? (
        <Health health={loaded.value} />
      ) : (
        <Alert tone="danger" title="The token could not be checked">
          <span className="[overflow-wrap:anywhere]">{loaded.message}</span>
        </Alert>
      )}

      <SectionPart title="Replace token" divided>
        <p className="text-sm text-muted-foreground">
          Paste a new token from the same Cloudflare account. Deparked checks it before saving it; the old one keeps
          working until then.
        </p>
        <Disclosure summary="How to make a new token">
          <p>
            Create a new token on Cloudflare's API token page with the same permissions, in the same account, and paste
            it here. Delete the old token on Cloudflare afterwards.
          </p>
          <p>It is stored only as a secret of the admin panel, and never shown again, here or anywhere else.</p>
        </Disclosure>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <label htmlFor={tokenId} className="text-sm font-semibold">
              New API token
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={tokenId}
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
                aria-describedby={helpId}
                className="min-w-0 flex-[1_1_14rem]"
              />
              <Button type="submit" aria-disabled={busy} className="max-sm:w-full">
                {busy ? "Checking…" : "Check and save"}
              </Button>
            </div>
            <p id={helpId} className="text-sm text-muted-foreground">
              It is never shown again, here or anywhere else.
            </p>
          </div>
          {result === null ? null : (
            <Alert tone={result.ok ? "success" : "danger"} title={result.ok ? "Token replaced" : "Not saved"}>
              <span className="[overflow-wrap:anywhere]">{result.message}</span>
            </Alert>
          )}
        </form>
      </SectionPart>
    </SettingsSection>
  );
}
