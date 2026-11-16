import { classifyMx, type DnsRecord, type MxState, type Rule, type WorkerRoute } from "@deparked/cf";
import { type DomainStatus, getDomain } from "@deparked/db";
import {
  activeLedger,
  normalizeHost,
  notInAccount,
  ownedIds,
  type ProvisionContext,
  workerNames,
  type ZoneRef,
} from "./context";
import {
  ADDRESS_RECORD_TYPES,
  type PathExclusion,
  PLACEHOLDER_RECORD,
  pathExclusions,
  ruleConflictReason,
  sameRule,
  wantedRedirectRules,
  wantedRewriteRules,
  wantedRoutes,
} from "./wanted";

export interface DomainInspection {
  host: string;
  /** Null when the host is not a domain (zone) of this account. */
  zone: (ZoneRef & { status: string | undefined }) | null;
  /** The domain this host is a part of, when the host itself is not a zone. Deparked v1 attaches whole domains only. */
  parentZone: string | null;
  /** The status of the `domains` row, when Deparked knows the host already. */
  managed: DomainStatus | null;
  /** Worker routes on the host or its `www` that are neither in Deparked's ledger nor point at its Workers. */
  routes: WorkerRoute[];
  /** Routes with exactly one of Deparked's patterns but another target. Taking them over needs the owner's OK. */
  sameRoutePatterns: WorkerRoute[];
  /** Paths of the host that keep going to the owner's Workers: Deparked's rewrite leaves them out. */
  keptPaths: PathExclusion[];
  /** Address records (A, AAAA, CNAME) that are not in Deparked's ledger. `wildcard` is `*.<host>`. */
  dns: { apex: DnsRecord[]; www: DnsRecord[]; wildcard: DnsRecord[] };
  mx: { state: MxState; targets: string[] };
  /** Rules of the zone that are not in Deparked's ledger. They stay as they are. */
  rules: { rewrite: Rule[]; redirect: Rule[] };
  /**
   * True when visitors get something on the host or its `www` today: an address record that goes through
   * Cloudflare to a server, a Worker route, or a rule written for the host. Attaching then needs
   * `takeOverLiveSite`.
   */
  servesWebsite: boolean;
  /** Reasons Deparked cannot attach the host until the owner changes something. Empty when it can. */
  blockers: string[];
  /** The same facts in plain words, for the add-domain screen. */
  summary: string;
}

/**
 * A redirect rule takes the whole host away when it is for the host (a quoted `host`, `www.host` or a
 * `.suffix` of it) or for every hostname of the zone (it names none, like `true`), and has no path condition.
 * ponytail: a path condition counts as "leaves the rest alone", so `not starts_with(path, "/x")` slips through;
 * parse the expression if that ever bites.
 */
export function redirectReachesHost(expression: string, host: string): boolean {
  if (/http\.request\.uri\.path/.test(expression)) return false;
  const quoted = [...expression.matchAll(/"([^"]*)"/g)].map((match) => (match[1] ?? "").toLowerCase());
  const namesHost = quoted.some(
    (text) =>
      text === host ||
      text === `www.${host}` ||
      (text.startsWith(".") && `.${host}`.endsWith(text)) ||
      text.includes(`//${host}`) ||
      text.includes(`//www.${host}`),
  );
  return namesHost || !/http\.host|http\.request\.full_uri/.test(expression);
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

const goesToServer = (record: DnsRecord) => record.proxied !== false && record.content !== PLACEHOLDER_RECORD.content;

function summarize(facts: Omit<DomainInspection, "summary">): string {
  const { host } = facts;
  if (facts.zone === null) return facts.blockers.join(" ");
  const sentences: string[] = [];
  if (facts.managed === "placeholder" || facts.managed === "live") {
    sentences.push(`${host} is already set up in Deparked.`);
  } else if (facts.servesWebsite) {
    sentences.push(
      `${host} shows a website today. Deparked will take over the address: visitors get the for-sale page instead. Your site and its settings stay untouched, and Turn off brings it back.`,
    );
  } else {
    sentences.push(
      `${host} shows nothing today. Deparked only adds what a for-sale page needs, and you can switch back at any time.`,
    );
  }
  const kept = facts.routes.filter((route) => !facts.sameRoutePatterns.includes(route));
  for (const route of kept) {
    if (route.pattern.split("/")[0] !== host) continue;
    sentences.push(`${route.pattern} keeps going to your Worker ${route.script ?? "setting"}.`);
  }
  if (facts.sameRoutePatterns.length > 0) {
    sentences.push(
      `Another Worker already answers on ${facts.sameRoutePatterns.map((route) => route.pattern).join(" and ")}. Deparked needs your OK to point that address at itself. It remembers the original, and Turn off puts it back.`,
    );
  }
  if (facts.dns.www.length === 0 && facts.dns.wildcard.length > 0 && !facts.dns.wildcard.some(goesToServer)) {
    sentences.push(`www.${host} is covered by your wildcard record and keeps going where it goes today.`);
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
 * Looks at what a domain does today, before anything changes. Read only: 9 requests for a domain of this
 * account, at most 4 for one that is not. Only what the ledger names counts as Deparked's.
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
      keptPaths: [],
      dns: { apex: [], www: [], wildcard: [] },
      mx: { state: "none" as const, targets: [] },
      rules: { rewrite: [], redirect: [] },
      servesWebsite: false,
      blockers: [blocker],
    };
    return { ...facts, summary: summarize(facts) };
  }

  const workers = workerNames(ctx);
  const deparkedWorkers = new Set([workers.sites, workers.admin]);
  const wanted = wantedRoutes(host, workers);
  const ledger = await activeLedger(ctx, host);
  const allRoutes = await ctx.cf.zones.listRoutes(zone.id);
  const apexRecords = await ctx.cf.zones.listDnsRecords(zone.id, { name: host });
  const wwwRecords = await ctx.cf.zones.listDnsRecords(zone.id, { name: `www.${host}` });
  const wildcardRecords = await ctx.cf.zones.listDnsRecords(zone.id, { name: `*.${host}` });
  const rewrite = await ctx.cf.rulesets.getEntrypoint(zone.id, "http_request_transform");
  const redirect = await ctx.cf.rulesets.getEntrypoint(zone.id, "http_request_dynamic_redirect");
  const foreign = [
    ...(await ctx.cf.redirects.pageRules(zone.id, host)),
    ...(await ctx.cf.redirects.bulkRedirects(host)),
  ];

  const ownedRecords = ownedIds(ledger, "dns_record");
  const ownedRoutes = ownedIds(ledger, "route");
  const ownedRules = ownedIds(ledger, "rule");
  const address = (records: DnsRecord[]) =>
    records.filter((record) => ADDRESS_RECORD_TYPES.includes(record.type) && !ownedRecords.has(record.id));
  const notOwned = (rule: Rule) => !ownedRules.has(rule.id);

  const unowned = allRoutes.filter((route) => !ownedRoutes.has(route.id));
  const routes = unowned.filter((route) => coversHost(route.pattern, host) && !deparkedWorkers.has(route.script ?? ""));
  const sameRoutePatterns = routes.filter((route) => wanted.some((entry) => entry.pattern === route.pattern));
  const { exclusions, inexpressible } = pathExclusions(
    unowned.filter((route) => !wanted.some((entry) => entry.pattern === route.pattern)),
    host,
  );
  const dns = { apex: address(apexRecords), www: address(wwwRecords), wildcard: address(wildcardRecords) };
  const mxRecords = apexRecords.filter((record) => record.type === "MX");
  const rules = {
    rewrite: (rewrite?.rules ?? []).filter(notOwned),
    redirect: (redirect?.rules ?? []).filter(notOwned),
  };
  const wantedRules = [...wantedRewriteRules(host, exclusions), ...wantedRedirectRules(host)];
  const lookAlike = (rule: Rule) => wantedRules.find((entry) => entry.description === rule.description);
  const forHost = [...rules.rewrite, ...rules.redirect].filter(
    (rule) => lookAlike(rule) === undefined && (rule.expression ?? "").includes(host),
  );

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
  if (inexpressible.length > 0) {
    blockers.push(
      `Deparked cannot work next to the Worker route ${inexpressible.map((route) => route.pattern).join(", ")} on ${host}: it could not leave those addresses out of its own rule. Remove or narrow that route in Cloudflare, then try again.`,
    );
  }
  for (const rule of [...rules.rewrite, ...rules.redirect]) {
    const twin = lookAlike(rule);
    if (twin !== undefined && !sameRule(rule, twin)) blockers.push(ruleConflictReason(host, twin.description));
  }
  // Redirects Cloudflare applies before Deparked's page ever runs: visitors, offers and /admin would all leave.
  for (const rule of rules.redirect) {
    if (lookAlike(rule) !== undefined || rule.enabled === false || !redirectReachesHost(rule.expression ?? "", host)) {
      continue;
    }
    blockers.push(
      `The redirect rule "${rule.description || rule.id}" sends visitors of ${host} elsewhere before Deparked's page can answer. Delete or turn it off in Cloudflare (${host} → Rules → Redirect Rules), then try again.`,
    );
  }
  for (const found of foreign) {
    blockers.push(
      found.kind === "page-rule"
        ? `The page rule for ${found.source} forwards visitors to ${found.target || "another address"} before Deparked's page can answer. Delete or turn it off in Cloudflare (${host} → Rules → Page Rules), then try again.`
        : `The bulk redirect ${found.source} in the list "${found.list}" sends visitors to ${found.target || "another address"} before Deparked's page can answer. Remove it in Cloudflare (Bulk Redirects, under your account), then try again.`,
    );
  }

  const facts = {
    host,
    zone: { id: zone.id, name: zone.name, status: zone.status },
    parentZone: null,
    managed,
    routes,
    sameRoutePatterns,
    keptPaths: exclusions,
    dns,
    mx: { state: classifyMx(mxRecords, host), targets: mxRecords.map((record) => record.content ?? "") },
    rules,
    servesWebsite:
      [...dns.apex, ...dns.www, ...dns.wildcard].some(goesToServer) || routes.length > 0 || forHost.length > 0,
    blockers,
  };
  return { ...facts, summary: summarize(facts) };
}
