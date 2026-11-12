import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Db } from "../client";
import { config, type Domain, type DomainStatus, domains, notifyAddresses, turnstileWidgets } from "../schema";

/** Every domain, by host. A full read of `domains` on purpose: the table holds at most a few hundred rows. */
export function listDomains(db: Db, options: { includeRemoved?: boolean } = {}): Promise<Domain[]> {
  const query = db.select().from(domains);
  return (options.includeRemoved ? query : query.where(ne(domains.status, "removed"))).orderBy(asc(domains.host));
}

export function getDomain(db: Db, host: string): Promise<Domain | undefined> {
  return db.select().from(domains).where(eq(domains.host, host)).get();
}

export type NewDomain = Pick<Domain, "host" | "zoneId"> &
  Partial<
    Pick<
      Domain,
      | "status"
      | "turnstileWidgetId"
      | "analyticsSiteTag"
      | "analyticsBeaconToken"
      | "emailRoutingState"
      | "senderHost"
      | "notifyEmail"
    >
  >;

/** Inserts the domain. Returns undefined, changing nothing, when the host already exists. */
export async function insertDomain(db: Db, input: { domain: NewDomain; now: number }): Promise<Domain | undefined> {
  const rows = await db
    .insert(domains)
    .values({ ...input.domain, createdAt: input.now, updatedAt: input.now })
    .onConflictDoNothing()
    .returning();
  return rows[0];
}

export type DomainPatch = Partial<
  Pick<
    Domain,
    | "zoneId"
    | "turnstileWidgetId"
    | "analyticsSiteTag"
    | "analyticsBeaconToken"
    | "emailRoutingState"
    | "senderHost"
    | "notifyEmail"
  >
>;

export async function updateDomain(
  db: Db,
  input: { host: string; patch: DomainPatch; now: number },
): Promise<Domain | undefined> {
  const rows = await db
    .update(domains)
    .set({ ...input.patch, updatedAt: input.now })
    .where(eq(domains.host, input.host))
    .returning();
  return rows[0];
}

/**
 * Sets the status and its timestamps: `off` stamps `turned_off_at`, `removed` stamps `removed_at`, and going back
 * to `placeholder` or `live` clears both. `error` leaves them alone.
 */
export async function setDomainStatus(
  db: Db,
  input: { host: string; status: DomainStatus; now: number },
): Promise<Domain | undefined> {
  const stamps: Partial<Pick<Domain, "turnedOffAt" | "removedAt">> =
    input.status === "off"
      ? { turnedOffAt: input.now }
      : input.status === "removed"
        ? { removedAt: input.now }
        : input.status === "error"
          ? {}
          : { turnedOffAt: null, removedAt: null };
  const rows = await db
    .update(domains)
    .set({ status: input.status, ...stamps, updatedAt: input.now })
    .where(eq(domains.host, input.host))
    .returning();
  return rows[0];
}

/**
 * Gives `email` to every domain (removed ones aside) that has no notify address, in one statement: a domain that
 * got one in the meantime keeps it. With `replaceUnverified`, also to every domain whose address is not verified:
 * only a verified address can be picked by hand, so those were given by default. Returns the hosts that got it.
 */
export async function assignMissingNotifyEmail(
  db: Db,
  input: { email: string; replaceUnverified?: boolean; now: number },
): Promise<string[]> {
  const unverified = db
    .select({ email: notifyAddresses.email })
    .from(notifyAddresses)
    .where(isNull(notifyAddresses.verifiedAt));
  const without = input.replaceUnverified
    ? or(isNull(domains.notifyEmail), inArray(domains.notifyEmail, unverified))
    : isNull(domains.notifyEmail);
  const rows = await db
    .update(domains)
    .set({ notifyEmail: input.email, updatedAt: input.now })
    .where(and(without, ne(domains.status, "removed")))
    .returning({ host: domains.host });
  return rows.map((row) => row.host);
}

export type OfferTarget = {
  host: string;
  status: DomainStatus;
  notifyEmail: string | null;
  senderHost: string | null;
  turnstileSecretName: string | null;
  liveJson: string | null;
  liveSchemaVersion: number | null;
};

/** What `POST /api/offer` needs to know about a host, in one read. Undefined when the host is not managed. */
export function getOfferTarget(db: Db, host: string): Promise<OfferTarget | undefined> {
  return db
    .select({
      host: domains.host,
      status: domains.status,
      notifyEmail: domains.notifyEmail,
      senderHost: domains.senderHost,
      turnstileSecretName: turnstileWidgets.secretName,
      liveJson: config.liveJson,
      liveSchemaVersion: config.liveSchemaVersion,
    })
    .from(domains)
    .leftJoin(turnstileWidgets, eq(turnstileWidgets.sitekey, domains.turnstileWidgetId))
    .leftJoin(config, eq(config.host, domains.host))
    .where(eq(domains.host, host))
    .get();
}
