import { expect, it } from "vitest";
import { compareVersions } from "./index";

it("orders release versions by semantic version precedence", () => {
  const ordered = [
    "0.9.9",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
    "1.0.1",
    "1.10.0",
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    expect(compareVersions(ordered[index] ?? "", ordered[index - 1] ?? ""), ordered[index]).toBe(1);
    expect(compareVersions(ordered[index - 1] ?? "", ordered[index] ?? "")).toBe(-1);
  }
  expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
  expect(compareVersions("0.0.2-e2e", "0.0.1-e2e")).toBe(1);
});
