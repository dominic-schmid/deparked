import { z } from "zod";
import type { FetchLike, Http } from "./http";
import { CloudflareApiError } from "./http";

export type TurnstileMode = "managed" | "non-interactive" | "invisible";

const widgetSchema = z.object({
  sitekey: z.string(),
  name: z.string(),
  mode: z.string(),
  domains: z.array(z.string()),
});
export type TurnstileWidget = z.infer<typeof widgetSchema>;

const widgetWithSecretSchema = widgetSchema.extend({ secret: z.string() });
export type TurnstileWidgetWithSecret = z.infer<typeof widgetWithSecretSchema>;

/** Hostnames one widget can hold on the free plan; the API rejects an eleventh. */
export const TURNSTILE_MAX_HOSTNAMES = 10;

export function turnstileApi(http: Http) {
  const base = `/accounts/${http.accountId}/challenges/widgets`;

  function remember(widget: TurnstileWidgetWithSecret): TurnstileWidgetWithSecret {
    http.hide(widget.secret);
    return widget;
  }

  return {
    /** Without secrets. One request per page of 50. */
    list(): Promise<TurnstileWidget[]> {
      return http.paginate({ call: "list Turnstile widgets", method: "GET", path: base }, widgetSchema);
    },
    /** The only response guaranteed to carry the secret: store it as a Worker secret right away. */
    async create(input: { name: string; domains: string[]; mode?: TurnstileMode }): Promise<TurnstileWidgetWithSecret> {
      const json = { name: input.name, domains: input.domains, mode: input.mode ?? "managed" };
      return remember(
        await http.request(
          { call: "create Turnstile widget", method: "POST", path: base, json },
          widgetWithSecretSchema,
        ),
      );
    },
    /** Replaces the widget's hostname list. Cloudflare wants name and mode resent, so pass the widget as read. */
    async updateHostnames(
      widget: Pick<TurnstileWidget, "sitekey" | "name" | "mode">,
      domains: string[],
    ): Promise<TurnstileWidget> {
      const json = { name: widget.name, mode: widget.mode, domains };
      const result = await http.request(
        { call: "update Turnstile hostnames", method: "PUT", path: `${base}/${widget.sitekey}`, json },
        widgetSchema.extend({ secret: z.string().optional() }),
      );
      if (result.secret !== undefined) http.hide(result.secret);
      return { sitekey: result.sitekey, name: result.name, mode: result.mode, domains: result.domains };
    },
    async getSecret(sitekey: string): Promise<string> {
      const widget = await http.request(
        { call: "read Turnstile secret", method: "GET", path: `${base}/${sitekey}` },
        widgetWithSecretSchema,
      );
      return remember(widget).secret;
    },
    async delete(sitekey: string): Promise<void> {
      await http.request(
        { call: "delete Turnstile widget", method: "DELETE", path: `${base}/${sitekey}` },
        z.unknown(),
      );
    },
  };
}

const siteverifySchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  challenge_ts: z.string().optional(),
  "error-codes": z
    .array(z.string())
    .optional()
    .transform((codes) => codes ?? []),
});

export interface SiteverifyResult {
  success: boolean;
  /** The hostname the challenge was solved on. The caller must compare it with the domain it serves. */
  hostname: string | undefined;
  action: string | undefined;
  challengeTs: string | undefined;
  errorCodes: string[];
}

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Checks a visitor's Turnstile token. Uses the widget secret, not the API token, so it is not on the client.
 * One request, no retries. A rejected token resolves with `success: false`; only a broken call throws.
 */
export async function verifyTurnstile(input: {
  secret: string;
  response: string;
  remoteIp?: string;
  fetch?: FetchLike;
  url?: string;
}): Promise<SiteverifyResult> {
  const call = "verify Turnstile token";
  const fetchImpl: FetchLike = input.fetch ?? ((url, init) => fetch(url, init));
  const body: Record<string, string> = { secret: input.secret, response: input.response };
  if (input.remoteIp !== undefined) body.remoteip = input.remoteIp;
  let response: Response;
  try {
    response = await fetchImpl(input.url ?? TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CloudflareApiError({ call, status: 0, detail: "network error" });
  }
  const parsed = siteverifySchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new CloudflareApiError({ call, status: response.status, detail: "unexpected response" });
  return {
    success: parsed.data.success,
    hostname: parsed.data.hostname,
    action: parsed.data.action,
    challengeTs: parsed.data.challenge_ts,
    errorCodes: parsed.data["error-codes"],
  };
}
