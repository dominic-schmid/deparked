const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | null): string | null {
  if (value === null || !URL.canParse(value)) return null;
  return new URL(value).origin;
}

/**
 * CSRF check for state-changing requests: the browser's `Origin` (or `Referer`, when a browser leaves `Origin`
 * out) must be the origin the request itself was sent to: scheme, host and port. Nothing is configured, so it
 * holds on `workers.dev` and on every managed domain. A request with neither header is rejected.
 */
export function isAllowedOrigin(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  // A present `Origin` decides alone: `Origin: null` (sandboxed or redirected) must not fall through to Referer.
  const source = originOf(request.headers.get("Origin") ?? request.headers.get("Referer"));
  return source !== null && source === new URL(request.url).origin;
}
