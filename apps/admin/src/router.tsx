import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn, getGlobalStartContext } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";

// The CSP nonce the request middleware made for this response; the router puts it on every script it renders.
const responseNonce = createIsomorphicFn()
  .server(() => getGlobalStartContext()?.nonce)
  .client(() => undefined);

export function getRouter() {
  const nonce = responseNonce();
  return createRouter({ routeTree, scrollRestoration: true, ...(nonce === undefined ? {} : { ssr: { nonce } }) });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
