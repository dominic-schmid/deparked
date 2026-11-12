import { classifyMx, type DnsRecord, type MxState, type Rule, type WorkerRoute } from "@deparked/cf";
import { type DomainStatus, getDomain } from "@deparked/db";
import {
  activeLedger,
  findEntry,
  normalizeHost,
  notInAccount,
  type ProvisionContext,
  workerNames,
  type ZoneRef,
} from "./context";
import { ADDRESS_RECORD_TYPES, wantedRoutes } from "./wanted";

export interface DomainInspection {
  host: string;
  /** Null when the host is not a domain (zone) of this account. */
  zone: (ZoneRef & { status: string | undefined }) | null;
  /** The domain this host is a part of, when the host itself is not a zone. Deparked v1 attaches whole domains only. */
  parentZone: string | null;
  /** The status of the `domains` row, when Deparked knows the host already. */
  managed: DomainStatus | null;
  /** Worker routes that answer on the host or its `www` and do not point at Deparked. */
  routes: WorkerRoute[];
  /** Routes with exactly one of Deparked's patterns but another target. Taking them over needs the owner's OK. */
  sameRoutePatterns: WorkerRoute[];
  /** Address records (A, AAAA, CNAME) that Deparked did not add. */
  dns: { apex: DnsRecord[]; www: DnsRecord[] };
  mx: { state: MxState; targets: string[] };
  /** Rules of the zone that are not Deparked's. They stay as they are. */
  rules: { rewrite: Rule[]; redirect: Rule[] };
  /** True when visitors get something on the host today. */
  servesWebsite: boolean;
  /** Reasons Deparked cannot attach the host until the owner changes something. Empty when it can. */
  blockers: string[];
  /** The same facts in plain words, for the add-domain screen. */
  summary: string;
}

function coversHost(pattern: string, host: string): boolean {
  const name = pattern.split("/")[0] ?? "";
  if (name.startsWith("*")) return host.endsWith(name.slice(1)) || `www.${host}`.endsWith(name.slice(1));
  return name === host || name === `www.${host}`;
}

/** The zone the host is a name inside of, looked up label by label. At most 3 requests. */
async function findParentZone(ctx: ProvisionContext, host: string): Promise<string | null> {
  const labels = host.split(".");
  for (let start = 1; start <= labels.length - 2 && start <= 3; start += 1) {
    const candidate = labels.slice(start).join(".");
    const [zone] = await ctx.cf.zones.list({ name: candidate });
    if (zone !== undefined) return zone.name;
  }
  return null;
}

function summarize(facts: Omit<DomainInspection, "summary">): string {
  const { host } = facts;
  if (facts.zone === null) return facts.blockers.join(" ");
  const sentences: string[] = [];
  if (facts.managed === "placeholder" || facts.managed === "live") {
    sentences.push(`${host} is already set up in Deparked.`);
  } else if (facts.servesWebsite) {
    sentences.push(
      `${host} shows a website today. Deparked will take over the address. Your site and its settings stay untouched, and you can switch back at any time.`,
    );
  } else {
    sentences.push(
      `${host} shows nothing today. Deparked only adds what a for-sale page needs, and you can switch back at any time.`,
    );
  }
  if (facts.sameRoutePatterns.length > 0) {
    sentences.push(
      `Another Worker already answers on ${facts.sameRoutePatterns.map((route) => route.pattern).join(" and ")}. Deparked needs your OK to point that address at itself. It remembers the original, and Turn off puts it back.`,
    );
  }
  if (facts.mx.state === "external") {
    sentences.push(
      `${host} receives email through another provider. Deparked leaves your mail alone unless you say otherwise.`,
    );
  } else if (facts.mx.state === "cloudflare") {
    sentences.push(`Email for ${host} already runs through Cloudflare, so offers can be sent from this domain.`);
  } else {
    sentences.push(
      `${host} has no email set up. Deparked will turn on Cloudflare's email service for it, so offers can be sent from this domain.`,
    );
  }
  return [...sentences, ...facts.blockers].join(" ");
}

/**
 * Looks at what a domain does today, before anything changes. Read only: 6 requests for a domain of this
 * account, at most 4 for one that is not.
 */
export async function inspectDomain(ctx: ProvisionContext, hostInput: string): Promise<DomainInspection> {
  const host = normalizeHost(hostInput);
  const managed = (await getDomain(ctx.db, host))?.status ?? null;
  const [zone] = await ctx.cf.zones.list({ name: host });

  if (zone === undefined) {
    const parentZone = await findParentZone(ctx, host);
    const blocker =
      parentZone === null
        ? notInAccount(host)
        : `${host} is a part of ${parentZone}. For now Deparked attaches whole domains only: pick ${parentZone} instead.`;
    const facts = {
      host,
      zone: null,
      parentZone,
      managed,
      routes: [],
      sameRoutePatterns: [],
      dns: { apex: [], www: [] },
      mx: { state: "none" as const, targets: [] },
      rules: { rewrite: [], redirect: [] },
      servesWebsite: false,
      blockers: [blocker],
    };
    return { ...facts, summary: summarize(facts) };
  }

  const workers = workerNames(ctx);
  const ours = new Set([workers.sites, workers.admin]);
  const wanted = wantedRoutes(host, workers);
  const ledger = await activeLedger(ctx, host);
  const allRoutes = await ctx.cf.zones.listRoutes(zone.id);
  const apexRecords = await ctx.cf.zones.listDnsRecords(zone.id, { name: host });
  const wwwRecords = await ctx.cf.zones.listDnsRecords(zone.id, { name: `www.${host}` });
  const rewrite = await ctx.cf.rulesets.getEntrypoint(zone.id, "http_request_transform");
  const redirect = await ctx.cf.rulesets.getEntrypoint(zone.id, "http_request_dynamic_redirect");

  const foreignAddress = (record: DnsRecord) =>
    ADDRESS_RECORD_TYPES.includes(record.type) && findEntry(ledger, "dns_record", record.id) === undefined;
  const notDeparked = (rule: Rule) => !(rule.description ?? "").startsWith(`Deparked ${host}:`);
  const routes = allRoutes.filter((route) => coversHost(route.pattern, host) && !ours.has(route.script ?? ""));
  const sameRoutePatterns = routes.filter((route) => wanted.some((entry) => entry.pattern === route.pattern));
  const dns = { apex: apexRecords.filter(foreignAddress), www: wwwRecords.filter(foreignAddress) };
  const mxRecords = apexRecords.filter((record) => record.type === "MX");

  const blockers: string[] = [];
  if (zone.status !== undefined && zone.status !== "active") {
    blockers.push(
      `${host} is not active on Cloudflare yet. Finish adding it in Cloudflare (its nameservers), then come back.`,
    );
  }
  if (dns.apex.length > 0 && dns.apex.every((record) => record.proxied === false)) {
    blockers.push(
      `${host} points straight at a server and not through Cloudflare (a grey cloud in Cloudflare's DNS settings). Deparked never edits your records, and it can only answer on addresses that go through Cloudflare. Switch the record to "Proxied" in Cloudflare, then try again.`,
    );
  }

  const facts = {
    host,
    zone: { id: zone.id, name: zone.name, status: zone.status },
    parentZone: null,
    managed,
    routes,
    sameRoutePatterns,
    dns,
    mx: { state: classifyMx(mxRecords, host), targets: mxRecords.map((record) => record.content ?? "") },
    rules: {
      rewrite: (rewrite?.rules ?? []).filter(notDeparked),
      redirect: (redirect?.rules ?? []).filter(notDeparked),
    },
    servesWebsite: dns.apex.length > 0 || routes.length > 0,
    blockers,
  };
  return { ...facts, summary: summarize(facts) };
}
