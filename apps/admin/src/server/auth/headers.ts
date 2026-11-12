import { randomBytes, toBase64Url } from "./encoding";

export function createNonce(): string {
  return toBase64Url(randomBytes(16));
}

/**
 * Headers for every response the admin Worker renders. `dev` only loosens what Vite's dev server needs (its
 * HMR websocket); it is never true in a build.
 *
 * - Scripts: our own files and the inline scripts TanStack Start marks with this response's nonce. No
 *   `unsafe-inline`, so inline event handlers and injected scripts do not run.
 * - Styles: `unsafe-inline` because React and the component library write `style` attributes and style tags.
 * - `frame-src 'self'` is for the sandboxed lander preview; `frame-ancestors 'none'` forbids framing the admin.
 * - Turnstile (challenges.cloudflare.com) is not allowed: nothing in the admin uses it.
 */
export function securityHeaders(options: { nonce: string; dev: boolean; setup?: boolean }): Record<string, string> {
  const csp = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${options.nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    options.dev ? "connect-src 'self' ws:" : "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ];
  return {
    "Content-Security-Policy": csp.join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    // The setup link's redirect carries the one-time secret in its URL: it sends no referrer at all.
    "Referrer-Policy": options.setup === true ? "no-referrer" : "same-origin",
    "X-Robots-Tag": "noindex",
    "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}
