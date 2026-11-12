type Vars = Record<string, unknown>;

function text(vars: Vars, name: string): string | undefined {
  const value = vars[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * `CLOUDFLARE_API_BASE` and `TURNSTILE_VERIFY_URL` exist for tests against a mock on this machine. Anything
 * but plain http to a loopback address with a port is ignored, so a variable set on a deployed Worker can never
 * send the API token or a Turnstile secret anywhere but Cloudflare.
 */
export function loopbackOverride(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const plain = url.protocol === "http:" && url.port !== "" && url.username === "" && url.password === "";
  return loopback && plain ? value : undefined;
}

/**
 * What `createCloudflareHosting` needs from the Worker's variables and secrets. Checking a bot token and
 * sending an email need neither the token nor the account, so the offer API works without them: the placeholder
 * account only makes API calls fail at Cloudflare instead of failing here.
 */
export function hostingConnection(vars: Vars, accountId?: string | null) {
  const baseUrl = loopbackOverride(text(vars, "CLOUDFLARE_API_BASE"));
  const botCheckUrl = loopbackOverride(text(vars, "TURNSTILE_VERIFY_URL"));
  return {
    token: text(vars, "CF_API_TOKEN") ?? "",
    accountId: accountId ?? text(vars, "CF_ACCOUNT_ID") ?? "unconfigured",
    getSecret: (ref: string) => text(vars, ref),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(botCheckUrl === undefined ? {} : { botCheckUrl }),
  };
}
