import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "../client";
import { config, type Domain, type DomainStatus, domains, turnstileWidgets } from "../schema";

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
 * got one in the meantime keeps it. Returns the hosts that got it.
 */
export async function assignMissingNotifyEmail(db: Db, input: { email: string; now: number }): Promise<string[]> {
  const rows = await db
    .update(domains)
    .set({ notifyEmail: input.email, updatedAt: input.now })
    .where(and(isNull(domains.notifyEmail), ne(domains.status, "removed")))
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
