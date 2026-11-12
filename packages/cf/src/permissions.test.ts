import { describe, expect, it } from "vitest";
import { TOKEN_PERMISSIONS, tokenTemplateUrl } from "./permissions";

describe("tokenTemplateUrl", () => {
  const url = new URL(tokenTemplateUrl());

  it("opens Cloudflare's Create Token page", () => {
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("dash.cloudflare.com");
    expect(url.pathname).toBe("/profile/api-tokens");
    expect([...url.searchParams.keys()].sort()).toEqual(["accountId", "name", "permissionGroupKeys", "zoneId"]);
    expect(url.searchParams.get("name")).toBe("Deparked");
    expect(url.searchParams.get("accountId")).toBe("*");
    expect(url.searchParams.get("zoneId")).toBe("all");
  });

  it("asks for exactly these permissions, no more", () => {
    expect(JSON.parse(url.searchParams.get("permissionGroupKeys") ?? "")).toEqual([
      { key: "workers_scripts", type: "edit" },
      { key: "d1", type: "edit" },
      { key: "account_settings", type: "edit" },
      { key: "account_analytics", type: "read" },
      { key: "turnstile", type: "edit" },
      { key: "email_routing_addresses", type: "edit" },
      { key: "zone", type: "read" },
      { key: "workers_routes", type: "edit" },
      { key: "dns", type: "edit" },
      { key: "zone_transform_rules", type: "edit" },
      { key: "dynamic_url_redirects", type: "edit" },
      { key: "zone_settings", type: "edit" },
      { key: "email_routing_rules", type: "edit" },
    ]);
    expect(TOKEN_PERMISSIONS).toHaveLength(13);
  });

  it("names the token as asked", () => {
    expect(new URL(tokenTemplateUrl("Deparked test")).searchParams.get("name")).toBe("Deparked test");
  });
});
