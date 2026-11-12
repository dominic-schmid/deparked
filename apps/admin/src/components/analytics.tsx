import { Alert, AlertDescription, AlertTitle } from "@deparked/ui/alert";
import { Button } from "@deparked/ui/button";
import { SparkChart } from "@deparked/ui/ruixen/spark-chart";
import { Link, useRouter } from "@tanstack/react-router";
import type { AnalyticsProblem } from "../server/analytics";

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

/** Offers per visit as a percentage, or null when there were no visits to divide by. */
export function formatConversion(offers: number, visits: number): string | null {
  if (visits === 0) return null;
  return new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 1 }).format(offers / visits);
}

/** The small line in a domain's row. Decorative: the counts next to it are its text. */
export function VisitsSparkline({ daily }: { daily: number[] }) {
  return (
    <div aria-hidden="true" className="w-20 shrink-0 text-primary">
      <SparkChart data={daily} height={24} color="currentColor" className="pointer-events-none" />
    </div>
  );
}

const TEXT_LINK =
  "rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Why visits are missing, with the fix when the owner can make one. Offers and the rest of the page still show. */
export function AnalyticsProblemAlert({ problem }: { problem: AnalyticsProblem }) {
  const router = useRouter();
  return (
    <Alert className="mb-6">
      <AlertTitle>Visits are not available right now</AlertTitle>
      <AlertDescription>
        <p>{problem.message}</p>
        {problem.credentials ? (
          <p>
            <Link to="/admin/settings/cloudflare" className={TEXT_LINK}>
              Check the Cloudflare token
            </Link>
          </p>
        ) : (
          <Button variant="outline" size="sm" className="mt-2" onClick={() => router.invalidate()}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
