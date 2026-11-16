// No imports: `scripts/build-release.ts` reads this file with plain Node.
export interface TokenPermission {
  /** Cloudflare's permission group key in the token page's `permissionGroupKeys` (undocumented, see below). */
  key: string;
  type: "read" | "edit";
  scope: "account" | "zone";
  /** The name on Cloudflare's token page. */
  label: string;
  /** Why Deparked needs it, in plain words. */
  why: string;
}

/**
 * Every permission the one token needs: the install (Workers, D1), the admin's daily work (bot check, visitor
 * statistics, offer emails) and adding domains (the zone rows). A key is the `label` of Cloudflare's permission
 * group without its `_read`/`_write` ending (Turnstile Sites Write is `challenge_widgets_write`, so
 * `challenge_widgets`). Cloudflare drops an unknown key from a user token link without a word
 * (developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/), so every key here is checked
 * against that list.
 */
export const TOKEN_PERMISSIONS: readonly TokenPermission[] = [
  {
    key: "workers_scripts",
    type: "edit",
    scope: "account",
    label: "Workers Scripts",
    why: "installs and updates the two Deparked Workers and publishes your pages",
  },
  { key: "d1", type: "edit", scope: "account", label: "D1", why: "sets up and updates the Deparked database" },
  {
    key: "account_settings",
    type: "read",
    scope: "account",
    label: "Account Settings",
    why: "lists the visitor statistics sites (Web Analytics) it made: Edit alone cannot",
  },
  {
    key: "account_settings",
    type: "edit",
    scope: "account",
    label: "Account Settings",
    why: "creates a visitor statistics site (Web Analytics) for each domain",
  },
  {
    key: "account_analytics",
    type: "read",
    scope: "account",
    label: "Account Analytics",
    why: "reads visitor numbers for the overview",
  },
  {
    key: "challenge_widgets",
    type: "edit",
    scope: "account",
    label: "Turnstile",
    why: "sets up the bot check of the offer form",
  },
  {
    key: "email_routing_address",
    type: "edit",
    scope: "account",
    label: "Email Routing Addresses",
    why: "adds the address offers are sent to",
  },
  {
    key: "mass_url_redirects",
    type: "read",
    scope: "account",
    label: "Mass URL Redirects",
    why: "finds bulk redirects that would send a domain's visitors elsewhere",
  },
  {
    key: "account_rule_lists",
    type: "read",
    scope: "account",
    label: "Account Rule Lists",
    why: "reads which addresses those bulk redirects cover",
  },
  { key: "zone", type: "read", scope: "zone", label: "Zone", why: "lists the domains in your account" },
  {
    key: "workers_routes",
    type: "edit",
    scope: "zone",
    label: "Workers Routes",
    why: "points a domain at its for-sale page",
  },
  {
    key: "dns",
    type: "edit",
    scope: "zone",
    label: "DNS",
    why: "adds an address record where a domain has none, and looks at existing mail records",
  },
  {
    key: "zone_transform_rules",
    type: "edit",
    scope: "zone",
    label: "Transform Rules",
    why: "maps each domain onto its own pages",
  },
  {
    key: "dynamic_redirect",
    type: "edit",
    scope: "zone",
    label: "Dynamic URL Redirects",
    why: "sends www to the domain itself",
  },
  {
    key: "zone_settings",
    type: "edit",
    scope: "zone",
    label: "Zone Settings",
    why: "turns on Cloudflare's email service for a domain, only when you allow it",
  },
  {
    key: "email_routing_rule",
    type: "edit",
    scope: "zone",
    label: "Email Routing Rules",
    why: "sends offer emails from the domain",
  },
];

/** Which `TOKEN_PERMISSIONS` row a probe in `probePermissions` stands for. */
export const PROBE_PERMISSION_LABELS: Readonly<Record<string, string>> = {
  "Workers Scripts": "Workers Scripts",
  D1: "D1",
  Turnstile: "Turnstile",
  "Account Settings (Web Analytics)": "Account Settings",
  "Email Routing Addresses": "Email Routing Addresses",
  "Mass URL Redirects": "Mass URL Redirects",
  "Account Rule Lists": "Account Rule Lists",
  Zone: "Zone",
  "Workers Routes": "Workers Routes",
  DNS: "DNS",
  "Transform Rules": "Transform Rules",
  "Dynamic Redirect": "Dynamic URL Redirects",
  "Zone Settings (Email Routing)": "Zone Settings",
};

/**
 * Cloudflare's Create Token page with the name and every permission filled in, for all accounts and zones. The
 * owner still scrolls down, continues, creates and copies: Cloudflare offers nothing shorter.
 *
 * Format: `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=<JSON>&name=<name>&accountId=*&zoneId=all`,
 * where `<JSON>` is `[{"key":"workers_scripts","type":"edit"},…]`, one entry per `TOKEN_PERMISSIONS` row.
 * `accountId=*` and `zoneId=all` preselect all accounts and all zones. `permissions.test.ts` pins it.
 */
export function tokenTemplateUrl(name = "Deparked"): string {
  const keys = JSON.stringify(TOKEN_PERMISSIONS.map(({ key, type }) => ({ key, type })));
  const query = new URLSearchParams({ permissionGroupKeys: keys, name, accountId: "*", zoneId: "all" });
  return `https://dash.cloudflare.com/profile/api-tokens?${query.toString()}`;
}
