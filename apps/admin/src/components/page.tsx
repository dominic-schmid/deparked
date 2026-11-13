import { Alert } from "@deparked/ui/arc/alert";
import { Skeleton } from "@deparked/ui/arc/skeleton";
import { Button } from "@deparked/ui/button";
import { useRouter } from "@tanstack/react-router";

/** A route's `pendingComponent`. */
export function PagePending() {
  return (
    <div className="max-w-2xl">
      <Skeleton label="Loading" lines={4} />
    </div>
  );
}

/** A route's `errorComponent`. The error itself may hold anything, so it is not shown. */
export function PageError() {
  const router = useRouter();
  return (
    <Alert tone="danger" title="This page could not be loaded" className="max-w-xl">
      <span className="block">The database or the connection did not answer. Nothing was changed.</span>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => router.invalidate()}>
        Try again
      </Button>
    </Alert>
  );
}
