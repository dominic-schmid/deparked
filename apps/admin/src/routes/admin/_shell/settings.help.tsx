import { CopyButton } from "@deparked/ui/arc/copy-button";
import { Button } from "@deparked/ui/button";
import { DISCUSSIONS_URL, diagnostics, diagnosticsText, REPOSITORY, type ReportInput } from "@deparked/ui/lib/report";
import { ReportDialog } from "@deparked/ui/report-problem";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useRelease } from "../../../components/report";
import { SectionPart, SettingsSection } from "../../../components/settings-ui";

export const Route = createFileRoute("/admin/_shell/settings/help")({
  // `?report=1` opens the report dialog: the command menu's "Report a problem".
  validateSearch: (search): { report?: 1 | undefined } => ({ report: search.report === 1 ? 1 : undefined }),
  head: () => ({ meta: [{ title: "Help · Deparked" }] }),
  component: Help,
});

const EXTERNAL = "inline-flex items-center gap-1.5";

function Help() {
  const release = useRelease();
  const { report } = Route.useSearch();
  const navigate = useNavigate();
  const input: ReportInput = { surface: "admin", place: "help", release };
  // Read in the browser: on the server `navigator` is Node's.
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(
      diagnosticsText(diagnostics({ surface: "admin", place: "help", release }, navigator.userAgent, new Date())),
    );
  }, [release]);
  const open = report === 1;
  const setOpen = (next: boolean) =>
    void navigate({ to: "/admin/settings/help", search: next ? { report: 1 } : {}, replace: true });

  return (
    <SettingsSection
      title="Help"
      lead="Deparked runs in your own Cloudflare account and sends nothing home. When something breaks, we only hear about it from you."
    >
      <SectionPart title="Something is not working">
        <p className="text-sm text-muted-foreground">
          Opens a GitHub issue with what you write and the details below. You see all of it before posting.
        </p>
        <div>
          <Button onClick={() => setOpen(true)}>Report a problem</Button>
        </div>
        <ReportDialog open={open} onOpenChange={setOpen} input={input} />
      </SectionPart>

      <SectionPart title="Questions and ideas" divided>
        <p className="text-sm text-muted-foreground">
          Ask how something works, or suggest what Deparked should do next.
        </p>
        <div>
          <Button asChild variant="outline">
            <a href={DISCUSSIONS_URL} target="_blank" rel="noreferrer" className={EXTERNAL}>
              Open GitHub Discussions <ExternalLink aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Button>
        </div>
      </SectionPart>

      <SectionPart title="Diagnostics" divided>
        <p className="text-sm text-muted-foreground">
          What a report includes. No domain names, account details or buyer data.
        </p>
        {text === null ? null : (
          <>
            <pre className="overflow-x-auto rounded-xl bg-secondary px-3 py-2.5 font-mono text-xs leading-relaxed">
              {text}
            </pre>
            <div>
              <CopyButton value={text} label="Copy diagnostics" />
            </div>
          </>
        )}
      </SectionPart>

      <SectionPart title="Documentation" divided>
        <a
          href={`https://github.com/${REPOSITORY}#readme`}
          target="_blank"
          rel="noreferrer"
          className={`${EXTERNAL} self-start text-sm font-medium underline underline-offset-2`}
        >
          Read the guide on GitHub <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </SectionPart>
    </SettingsSection>
  );
}
