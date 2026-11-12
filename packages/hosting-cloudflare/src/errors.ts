import { CloudflareApiError } from "@deparked/cf";
import { HostingError } from "@deparked/hosting";

export function toHostingError(error: CloudflareApiError): HostingError {
  const options = { cause: error };
  // The upload of file bodies authenticates with the upload session, so a 401 there says nothing about the token.
  if ((error.status === 401 || error.status === 403) && error.call !== "upload assets") {
    return new HostingError(
      "credentials-rejected",
      `Cloudflare rejected the saved API token, or the token lacks a permission (${error.call}). Replace the token in Settings.`,
      options,
    );
  }
  if (error.status === 404) return new HostingError("not-found", error.message, options);
  if (error.status === 409) return new HostingError("conflict", error.message, options);
  if (error.status === 429) return new HostingError("rate-limited", error.message, options);
  if (error.status === 0 || error.status >= 500) return new HostingError("unavailable", error.message, options);
  return new HostingError("failed", error.message, options);
}

/** Runs Cloudflare calls and turns their errors into `HostingError`s. Other errors (the caller's own) pass through. */
export async function cloudflare<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw error instanceof CloudflareApiError ? toHostingError(error) : error;
  }
}
