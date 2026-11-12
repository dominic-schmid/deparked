import { Alert, AlertDescription, AlertTitle } from "@deparked/ui/alert";
import { Button } from "@deparked/ui/button";
import { Link } from "@tanstack/react-router";
import { MailWarning } from "lucide-react";
import type { ReactNode } from "react";
import type { OfferMail } from "../server/notify-default";

type Problem = Exclude<OfferMail, { state: "ok" }>;

const REASON: Record<Problem["state"], (mail: Problem) => string> = {
  "no-address": () => "There is no address for offers yet.",
  unverified: (mail) =>
    `${"email" in mail ? mail.email : "Its address"} is not verified yet: the link in Cloudflare's email has not been clicked.`,
  unassigned: () => "None of your verified addresses is picked for it.",
};

const FIX_LABEL: Record<Problem["state"], string> = {
  "no-address": "Add an address",
  unverified: "Verify the address",
  unassigned: "Pick an address",
};

/** The one place that fixes it: the notify addresses, or the domain's own settings when only a pick is missing. */
function FixLink({ host, mail, ...rest }: { host: string; mail: Problem; className?: string; children?: ReactNode }) {
  return mail.state === "unassigned" ? (
    <Link to="/admin/d/$host/settings" params={{ host }} {...rest} />
  ) : (
    <Link to="/admin/settings" {...rest} />
  );
}

/** "Offers for example.com are saved in the inbox but not emailed yet", why, and the fix one click away. */
export function OfferMailNotice({ host, mail }: { host: string; mail: OfferMail }) {
  if (mail.state === "ok") return null;
  return (
    <Alert role="note" className="mb-6 border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20">
      <MailWarning aria-hidden="true" className="text-amber-700 dark:text-amber-400" />
      <AlertTitle>Offers for {host} are saved in the inbox but not emailed yet</AlertTitle>
      <AlertDescription>
        <p className="[overflow-wrap:anywhere]">{REASON[mail.state](mail)}</p>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <FixLink host={host} mail={mail}>
            {FIX_LABEL[mail.state]}
          </FixLink>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** The overview row's short form: what is wrong, as a link to the fix. */
export function OfferMailBadge({ host, mail }: { host: string; mail: OfferMail }) {
  if (mail.state === "ok") return null;
  return (
    <FixLink
      host={host}
      mail={mail}
      className="inline-flex items-center gap-1.5 rounded-sm text-sm whitespace-nowrap text-amber-800 underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:text-amber-300"
    >
      <MailWarning aria-hidden="true" className="size-3.5 shrink-0" />
      {`Not emailed: ${FIX_LABEL[mail.state].toLowerCase()}`}
    </FixLink>
  );
}
