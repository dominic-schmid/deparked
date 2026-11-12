import { z } from "zod";
import { CloudflareApiError, type Http, segment } from "./http";
import { type DnsRecord, type Zone, zonesApi } from "./zones";

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

const hostname = (name: string) => name.toLowerCase().replace(/\.$/, "");

/**
 * What the MX records of the zone apex mean for Email Routing: targets under `mx.cloudflare.net` mean it is
 * already on; anything else is existing mail that enabling Email Routing would replace. Records of other
 * names (subdomains) are ignored.
 */
export function classifyMx(records: readonly Pick<DnsRecord, "type" | "name" | "content">[], apex: string): MxState {
  const targets = records
    .filter((record) => record.type === "MX" && hostname(record.name) === hostname(apex))
    .map((record) => hostname(record.content ?? ""));
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
        { call: "delete notify address", method: "DELETE", path: `${addresses}/${segment(addressId)}` },
        z.unknown(),
      );
    },
    getRouting(zoneId: string): Promise<EmailRoutingSettings> {
      return http.request(
        { call: "read Email Routing settings", method: "GET", path: `/zones/${segment(zoneId)}/email/routing` },
        routingSchema,
      );
    },
    /**
     * Enabling Email Routing replaces the apex MX records. This reads them first and refuses when they point at
     * someone else's mail, unless the owner agreed (`replaceExistingMx: true`). 2 requests (before retries).
     */
    async enableRouting(
      zone: Pick<Zone, "id" | "name">,
      consent: { replaceExistingMx: boolean },
    ): Promise<EmailRoutingSettings> {
      const call = "enable Email Routing";
      const mx = await zonesApi(http).listDnsRecords(zone.id, { type: "MX", name: zone.name });
      if (classifyMx(mx, zone.name) === "external" && !consent.replaceExistingMx) {
        throw new CloudflareApiError({
          call,
          status: 0,
          detail:
            "the domain already receives mail elsewhere (existing MX records) and replacing them was not confirmed",
        });
      }
      return http.request(
        { call, method: "POST", path: `/zones/${segment(zone.id)}/email/routing/enable`, json: {} },
        routingSchema,
      );
    },
  };
}
