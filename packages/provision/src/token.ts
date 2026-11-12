import { CloudflareApiError, type CloudflareClient, PROBE_PERMISSION_LABELS, TOKEN_PERMISSIONS } from "@deparked/cf";

/** A permission the token lacks or that could not be tried, with why Deparked needs it. */
export interface PermissionGap {
  label: string;
  why: string;
  scope: "account" | "zone";
}

function gap(label: string): PermissionGap {
  const permission = TOKEN_PERMISSIONS.find((entry) => entry.label === label);
  return { label, why: permission?.why ?? "", scope: permission?.scope ?? "account" };
}

/**
 * Tries each permission Deparked needs with a harmless read. Zone permissions are tried on the account's first
 * domain; without one they are `unchecked`, like a probe that answered 404 (a zone without rules yet).
 */
export async function checkTokenPermissions(
  cf: CloudflareClient,
): Promise<{ missing: PermissionGap[]; unchecked: PermissionGap[] }> {
  let zoneId: string | undefined;
  try {
    zoneId = (await cf.zones.list({}, { perPage: 5, maxPages: 1 }))[0]?.id;
  } catch (error) {
    if (!(error instanceof CloudflareApiError && error.status === 403)) throw error;
  }
  const report = await cf.tokens.probePermissions(zoneId === undefined ? {} : { zoneId });
  const label = (probe: string) => PROBE_PERMISSION_LABELS[probe] ?? probe;
  const missing = report.missing.map(label);
  const zoneLabels = TOKEN_PERMISSIONS.filter((entry) => entry.scope === "zone" && entry.label !== "Zone").map(
    (entry) => entry.label,
  );
  const unchecked = zoneId === undefined ? zoneLabels : report.unknown.map(label);
  return {
    missing: missing.map(gap),
    unchecked: unchecked.filter((entry) => !missing.includes(entry)).map(gap),
  };
}
