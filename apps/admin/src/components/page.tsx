import { Alert, AlertDescription, AlertTitle } from "@deparked/ui/alert";
import { Button } from "@deparked/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { Skeleton } from "@deparked/ui/skeleton";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function PageHeader(props: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance [overflow-wrap:anywhere]">{props.title}</h1>
        {props.description ? <p className="mt-1 text-sm text-muted-foreground">{props.description}</p> : null}
      </div>
      {props.actions}
    </div>
  );
}

/** A route's `pendingComponent`. */
export function PagePending() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/** A route's `errorComponent`. The error itself may hold anything, so it is not shown. */
export function PageError() {
  const router = useRouter();
  return (
    <Alert variant="destructive" className="max-w-xl">
      <AlertTitle>This page could not be loaded</AlertTitle>
      <AlertDescription>
        <p>The database or the connection did not answer. Nothing was changed.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => router.invalidate()}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** A feature that a later release brings. */
export function ComingSoon(props: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>
          <h2>{props.title}</h2>
        </CardTitle>
        <CardDescription>{props.children}</CardDescription>
      </CardHeader>
      {props.action ? <CardContent>{props.action}</CardContent> : null}
    </Card>
  );
}

const TAB =
  "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-secondary aria-[current=page]:text-foreground";

/** Class for a link in a row of section links. The router marks the current one with `aria-current`. */
export const tabLinkClass = TAB;

export function TabNav(props: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={props.label} className="-mx-1 mb-6 flex flex-wrap gap-1 border-b px-1 pb-2">
      {props.children}
    </nav>
  );
}
