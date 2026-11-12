// Apex DNS records in the shape Cloudflare's `GET /zones/:zone/dns_records` returns them, for the three mail
// situations a domain can be in. Ids and addresses are documentation values.
import type { MockDnsRecord } from "@deparked/cf/mock";

function record(fields: { id: string; type: string; content: string; priority?: number }): MockDnsRecord {
  const full = {
    name: "example.com",
    proxiable: false,
    proxied: false,
    ttl: 1,
    settings: {},
    meta: {},
    comment: null,
    tags: [],
    created_on: "2026-01-01T00:00:00.000000Z",
    modified_on: "2026-01-01T00:00:00.000000Z",
    ...fields,
  };
  return full;
}

const spf = record({
  id: "023e105f4ecef8ad9ca31a8372d0c351",
  type: "TXT",
  content: '"v=spf1 include:_spf.google.com ~all"',
});

/** No MX at all: the domain receives no mail. */
export const MX_NONE: MockDnsRecord[] = [
  record({ id: "023e105f4ecef8ad9ca31a8372d0c350", type: "TXT", content: '"some-site-verification=abc"' }),
];

/** Email Routing is already on: Cloudflare's three MX hosts. */
export const MX_CLOUDFLARE: MockDnsRecord[] = [
  record({ id: "023e105f4ecef8ad9ca31a8372d0c361", type: "MX", content: "route1.mx.cloudflare.net", priority: 46 }),
  record({ id: "023e105f4ecef8ad9ca31a8372d0c362", type: "MX", content: "route2.mx.cloudflare.net", priority: 8 }),
  record({ id: "023e105f4ecef8ad9ca31a8372d0c363", type: "MX", content: "route3.mx.cloudflare.net", priority: 90 }),
  record({
    id: "023e105f4ecef8ad9ca31a8372d0c364",
    type: "TXT",
    content: '"v=spf1 include:_spf.mx.cloudflare.net ~all"',
  }),
];

/** Mail at another provider. */
export const MX_EXTERNAL: MockDnsRecord[] = [
  record({ id: "023e105f4ecef8ad9ca31a8372d0c371", type: "MX", content: "aspmx.l.google.com", priority: 1 }),
  record({ id: "023e105f4ecef8ad9ca31a8372d0c372", type: "MX", content: "alt1.aspmx.l.google.com", priority: 5 }),
  spf,
];
