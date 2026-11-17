import { describe, expect, it } from "vitest";
import {
  diagnostics,
  diagnosticsText,
  issueTitle,
  issueUrl,
  platform,
  reportText,
  SUMMARY_MAX,
  URL_LIMIT,
} from "./report";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const NOW = new Date("2026-11-17T17:34:25.123Z");

describe("diagnostics", () => {
  it("keeps the allowed fields and reduces the platform to families", () => {
    const value = diagnostics(
      { surface: "admin", place: "publish", release: "0.1.3", code: "failed", step: "routes", attempts: 2 },
      CHROME_MAC,
      NOW,
    );
    expect(diagnosticsText(value)).toBe(
      [
        "surface: admin",
        "place: publish",
        "release: 0.1.3",
        "code: failed",
        "step: routes",
        "attempts: 2",
        "browser: Chrome 142",
        "os: macOS",
        "time: 2026-11-17T17:34Z",
      ].join("\n"),
    );
  });

  it("never lets a hostname, email, account ID or token through", () => {
    const secrets = [
      "shop.example.com",
      "buyer@example.com",
      "023e105f4ecef8ad9ca31a8372d0c353",
      "Abc123_tokenTOKENtoken-0123456789abcdefXY",
      "https://admin.example.com/admin/setup?secret=abc",
    ];
    for (const secret of secrets) {
      const value = diagnostics(
        { surface: "admin", place: "domain-setup", release: secret, code: secret, step: secret },
        CHROME_MAC,
        NOW,
      );
      const sent = `${issueUrl(value, "")}\n${reportText(value, "")}`;
      expect(sent).not.toContain(secret);
      expect(decodeURIComponent(sent)).not.toContain(secret);
      expect(value.code).toBe("unknown");
      expect(value.release).toBe("unknown");
    }
  });

  it("keeps only the step of a host-scoped step ID", () => {
    const value = diagnostics(
      { surface: "admin", place: "uninstall", release: "0.1.3", step: "shop.example.com:stop-routes" },
      CHROME_MAC,
      NOW,
    );
    expect(value.step).toBe("stop-routes");
    expect(diagnosticsText(value)).not.toContain("example");
  });

  it("names a build without a release", () => {
    expect(diagnostics({ surface: "installer", place: "install", release: null }, "", NOW).release).toBe("development");
  });
});

describe("platform", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0", "Firefox 133", "Windows"],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      "Safari 18",
      "iOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
      "Edge 142",
      "Windows",
    ],
    ["curl/8.0", "Other", "Other"],
  ])("%s", (userAgent, browser, os) => {
    expect(platform(userAgent)).toEqual({ browser, os });
  });
});

describe("issueUrl", () => {
  const value = diagnostics({ surface: "installer", place: "install", release: "0.1.3", step: "migrate" }, "", NOW);

  it("fills the issue form's fields", () => {
    const url = new URL(issueUrl(value, "  The install stopped at the database step.  "));
    expect(url.origin + url.pathname).toBe("https://github.com/dominic-schmid/deparked/issues/new");
    expect(url.searchParams.get("template")).toBe("problem.yml");
    expect(url.searchParams.get("title")).toBe("Installer, install: The install stopped at the database step.");
    expect(url.searchParams.get("summary")).toBe("The install stopped at the database step.");
    expect(url.searchParams.get("diagnostics")).toBe(diagnosticsText(value));
  });

  it("titles the issue with the summary's first line, cut to fit", () => {
    expect(issueTitle(value, "Short.\nMore detail.")).toBe("Installer, install: Short.");
    const title = issueTitle(value, "word ".repeat(40));
    expect([...title.slice("Installer, install: ".length)]).toHaveLength(72);
    expect(title.endsWith("…")).toBe(true);
  });

  it("cuts the summary to SUMMARY_MAX characters", () => {
    const url = issueUrl(value, "a".repeat(SUMMARY_MAX + 500));
    expect(new URL(url).searchParams.get("summary")).toHaveLength(SUMMARY_MAX);
  });

  it("stays under GitHub's URL limit when every character needs escaping, and keeps the diagnostics", () => {
    for (const summary of ["é".repeat(SUMMARY_MAX), "🙂".repeat(SUMMARY_MAX)]) {
      const url = issueUrl(value, summary);
      expect(url.length).toBeLessThanOrEqual(URL_LIMIT);
      expect(new URL(url).searchParams.get("diagnostics")).toBe(diagnosticsText(value));
      expect(new URL(url).searchParams.get("summary")?.length).toBeGreaterThan(100);
    }
  });
});
