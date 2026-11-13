import { Alert } from "@deparked/ui/arc/alert";
import { Sparkline } from "@deparked/ui/arc/sparkline";
import { Button } from "@deparked/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@deparked/ui/popover";
import { Link, useRouter } from "@tanstack/react-router";
import type { AnalyticsProblem } from "../server/analytics-shape";

// One fixed locale, as in format.ts: the server and the browser must print the same text.
const LOCALE = "en";

export function formatCount(value: number): string {
  return value.toLocaleString(LOCALE);
}

/** Short for big numbers, where a table cell has no room: 1,730 stays, 29,629,630 is 29.6M. */
export function formatCompactCount(value: number): string {
  if (value < 100_000) return formatCount(value);
  return new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/**
 * Offers per visit as a percentage, or null when there were no visits to divide by. More offers than counted
 * visits (blocked beacons, a visit counted on another day) reads ">100%" rather than a made-up rate.
 */
export function formatConversion(offers: number, visits: number): string | null {
  if (visits === 0) return null;
  if (offers > visits) return ">100%";
  return new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 1 }).format(offers / visits);
}

/** Why more offers than visits can happen, for the ">100%" the conversion shows then. */
export const OVER_100 =
  "More offers than counted visits. Web Analytics does not count visitors who block its script, and an offer can come from a visit counted on another day.";

/** A conversion figure. ">100%" opens a short explanation, by click, tap or keyboard. */
export function ConversionValue({ value }: { value: string }) {
  if (value !== ">100%") return <span className="tabular-nums">{value}</span>;
  return (
    <Popover>
      <PopoverTrigger className="cursor-help rounded-sm tabular-nums underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {value}
        <span className="sr-only">, why?</span>
      </PopoverTrigger>
      <PopoverContent className="text-sm text-pretty">{OVER_100}</PopoverContent>
    </Popover>
  );
}

/** The small line in a domain's row. Decorative: the counts next to it are its text, so Arc's caption is hidden. */
export function VisitsSparkline({ daily }: { daily: number[] }) {
  return (
    <div aria-hidden="true" inert className="w-20 shrink-0 [&_figcaption]:hidden [&_figure]:gap-0">
      <Sparkline data={daily} label="Visits" width={80} height={24} area={false} interactive={false} />
    </div>
  );
}

const TEXT_LINK =
  "rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Why visits are missing, with the fix when the owner can make one. Offers and the rest of the page still show. */
export function AnalyticsProblemAlert({
  problem,
  className = "mb-6",
}: {
  problem: AnalyticsProblem;
  className?: string;
}) {
  const router = useRouter();
  return (
    <Alert tone="warning" title="Visits are not available right now" className={className}>
      <span className="block">{problem.message}</span>
      {problem.credentials ? (
        <span className="mt-1 block">
          <Link to="/admin/settings/cloudflare" className={TEXT_LINK}>
            Check the Cloudflare token
          </Link>
        </span>
      ) : (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => router.invalidate()}>
          Try again
        </Button>
      )}
    </Alert>
  );
}
