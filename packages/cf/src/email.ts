import { z } from "zod";
import type { Http } from "./http";
import type { DnsRecord } from "./zones";

const addressSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    verified: z.string().nullish(),
  })
  .transform((address) => ({ id: address.id, email: address.email, verifiedAt: address.verified ?? null }));
/** `verifiedAt` is null until the owner clicks the link in Cloudflare's verification email. */
export type DestinationAddress = z.infer<typeof addressSchema>;

const routingSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  status: z.string().optional(),
});
export type EmailRoutingSettings = z.infer<typeof routingSchema>;

export type MxState = "none" | "cloudflare" | "external";

/**
 * What the apex MX records mean for Email Routing: targets under `mx.cloudflare.net` mean it is already on;
 * anything else is existing mail that enabling Email Routing would replace.
 */
export function classifyMx(records: readonly Pick<DnsRecord, "type" | "content">[]): MxState {
  const targets = records
    .filter((record) => record.type === "MX")
    .map((record) => (record.content ?? "").toLowerCase().replace(/\.$/, ""));
  if (targets.length === 0) return "none";
  return targets.every((target) => target.endsWith(".mx.cloudflare.net")) ? "cloudflare" : "external";
}

export function emailApi(http: Http) {
  const addresses = `/accounts/${http.accountId}/email/routing/addresses`;
  return {
    /** One request per page of 50. */
    listAddresses(): Promise<DestinationAddress[]> {
      return http.paginate({ call: "list notify addresses", method: "GET", path: addresses }, addressSchema);
    },
    /** Cloudflare sends its verification email to the address. */
    createAddress(email: string): Promise<DestinationAddress> {
      return http.request(
        { call: "create notify address", method: "POST", path: addresses, json: { email } },
        addressSchema,
      );
    },
    async deleteAddress(addressId: string): Promise<void> {
      await http.request(
        { call: "delete notify address", method: "DELETE", path: `${addresses}/${addressId}` },
        z.unknown(),
      );
    },
    getRouting(zoneId: string): Promise<EmailRoutingSettings> {
      return http.request(
        { call: "read Email Routing settings", method: "GET", path: `/zones/${zoneId}/email/routing` },
        routingSchema,
      );
    },
    /** Replaces the zone's MX records. Check `classifyMx` and ask the owner first. */
    enableRouting(zoneId: string): Promise<EmailRoutingSettings> {
      return http.request(
        { call: "enable Email Routing", method: "POST", path: `/zones/${zoneId}/email/routing/enable`, json: {} },
        routingSchema,
      );
    },
  };
}
