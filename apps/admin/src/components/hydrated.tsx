import { type ReactNode, useEffect, useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False on the server and while the page hydrates; true once React runs in the browser. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Every control inside stays disabled until the page has hydrated: these screens work through server functions,
 * so a click or a keystroke before React runs would be lost (or submit a form natively). The disabled look says
 * "not ready yet"; it usually lasts a moment. `<html data-hydrated>` marks the moment for tests.
 * Login and setup are plain form posts that work without JavaScript and are not wrapped.
 */
export function UntilHydrated({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  useEffect(() => {
    if (hydrated) document.documentElement.dataset.hydrated = "";
  }, [hydrated]);
  return (
    <fieldset role="none" disabled={!hydrated} aria-busy={!hydrated || undefined} className="contents">
      {children}
    </fieldset>
  );
}
