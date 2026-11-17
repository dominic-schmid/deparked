// "Report a problem": the anonymous diagnostics a user sends with a GitHub issue, and the link that prefills it.
// The issue is public, so the diagnostics hold a closed set of fields, and every free-form value must be a short
// lowercase slug: no dots, colons, @ or capitals, so no hostname, email, account ID or token can pass. A value that
// is not one becomes "unknown" rather than being sent. The user writes the summary and sees all of it before sending.

export const REPOSITORY = "dominic-schmid/deparked";
export const DISCUSSIONS_URL = `https://github.com/${REPOSITORY}/discussions`;
export const ISSUE_TEMPLATE = "problem.yml";

export const SUMMARY_MIN = 20;
export const SUMMARY_MAX = 1500;

/** Where in the app the report starts. Add a place here before using it. */
export type ReportPlace =
  | "help"
  | "page-error"
  | "domain-setup"
  | "publish"
  | "update"
  | "uninstall"
  | "install"
  | "install-finish";

export interface ReportInput {
  surface: "admin" | "installer";
  place: ReportPlace;
  /** The installed release, e.g. "0.1.3". Null for a development build. */
  release: string | null;
  /** A machine error code, e.g. "release" or "failed". Never a message. */
  code?: string;
  /** The step that failed, by ID. A `host:step` ID keeps only the step. */
  step?: string;
  /** How many times the user ran the failed action. */
  attempts?: number;
}

export interface Diagnostics {
  surface: "admin" | "installer";
  place: ReportPlace;
  release: string;
  code?: string;
  step?: string;
  attempts?: number;
  browser: string;
  os: string;
  time: string;
}

// Words of at most 16 characters, starting with a letter: step IDs and codes fit, a 32-character account ID or a
// token does not.
const SLUG = /^[a-z][a-z0-9]{0,15}(-[a-z0-9]{1,16}){0,4}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[a-z0-9.]{1,20})?$/;

function slug(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return SLUG.test(value) ? value : "unknown";
}

/** Browser family and major version, and OS family, from a user agent. Nothing finer. */
export function platform(userAgent: string): { browser: string; os: string } {
  const major = (pattern: RegExp) => userAgent.match(pattern)?.[1];
  const [name, version] = /Edg\//.test(userAgent)
    ? ["Edge", major(/Edg\/(\d+)/)]
    : /Firefox\//.test(userAgent)
      ? ["Firefox", major(/Firefox\/(\d+)/)]
      : /Chrome\//.test(userAgent)
        ? ["Chrome", major(/Chrome\/(\d+)/)]
        : /Safari\//.test(userAgent)
          ? ["Safari", major(/Version\/(\d+)/)]
          : ["Other", undefined];
  const os = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Other";
  return { browser: version === undefined ? name : `${name} ${version}`, os };
}

export function diagnostics(input: ReportInput, userAgent: string, now: Date): Diagnostics {
  const step = input.step === undefined ? undefined : input.step.slice(input.step.lastIndexOf(":") + 1);
  const code = slug(input.code);
  const cleanStep = slug(step);
  const attempts =
    input.attempts !== undefined && Number.isInteger(input.attempts) && input.attempts >= 0
      ? Math.min(input.attempts, 99)
      : undefined;
  return {
    surface: input.surface,
    place: input.place,
    release: input.release === null ? "development" : VERSION.test(input.release) ? input.release : "unknown",
    ...(code === undefined ? {} : { code }),
    ...(cleanStep === undefined ? {} : { step: cleanStep }),
    ...(attempts === undefined ? {} : { attempts }),
    ...platform(userAgent),
    // To the minute: enough to match a release, not a fingerprint.
    time: `${now.toISOString().slice(0, 16)}Z`,
  };
}

/** The diagnostics as the plain lines the user sees, copies and sends. */
export function diagnosticsText(value: Diagnostics): string {
  const lines: [string, string | number | undefined][] = [
    ["surface", value.surface],
    ["place", value.place],
    ["release", value.release],
    ["code", value.code],
    ["step", value.step],
    ["attempts", value.attempts],
    ["browser", value.browser],
    ["os", value.os],
    ["time", value.time],
  ];
  return lines
    .filter((line): line is [string, string | number] => line[1] !== undefined)
    .map(([key, item]) => `${key}: ${item}`)
    .join("\n");
}

/** "Admin, publish: <the summary's first line, cut to fit>". The owner can still change it on GitHub. */
export function issueTitle(value: Diagnostics, summary: string): string {
  const where = `${value.surface === "installer" ? "Installer" : "Admin"}, ${value.place}`;
  const line = summary.trim().split("\n")[0]?.trim() ?? "";
  const words = [...line];
  return words.length <= 72 ? `${where}: ${line}` : `${where}: ${words.slice(0, 71).join("").trimEnd()}…`;
}

/** GitHub refuses longer new-issue links; leave room for its own redirect parameters. */
export const URL_LIMIT = 7000;

/**
 * The new-issue link with the issue form's fields filled in: `summary` (what the user wrote) and `diagnostics`. The
 * form's own `screenshot` field is for the user to fill on GitHub. A summary too long for the link is cut, never the
 * diagnostics; the dialog's Copy button carries all of it.
 */
export function issueUrl(value: Diagnostics, summary: string): string {
  let text = [...summary.trim()].slice(0, SUMMARY_MAX);
  for (;;) {
    const params = new URLSearchParams({
      template: ISSUE_TEMPLATE,
      title: issueTitle(value, text.join("")),
      summary: text.join(""),
      diagnostics: diagnosticsText(value),
    });
    const url = `https://github.com/${REPOSITORY}/issues/new?${params.toString()}`;
    if (url.length <= URL_LIMIT || text.length === 0) return url;
    text = text.slice(0, Math.floor(text.length * 0.9));
  }
}

/** What "Copy" puts on the clipboard: the summary, then the diagnostics. */
export function reportText(value: Diagnostics, summary: string): string {
  const text = summary.trim();
  return `${text === "" ? "" : `${text}\n\n`}${diagnosticsText(value)}`;
}
