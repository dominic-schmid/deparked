import { type Db, getWorkspaceMark, listDomains, listNotifyAddresses, listPublishedAt } from "@deparked/db";

export type ChecklistStepId = "address" | "verify" | "domain" | "publish";

/** The overview's "Finish setting up" card: each step's real state, in the order the owner does them. */
export type SetupChecklist = {
  steps: { id: ChecklistStepId; done: boolean }[];
  /** The address the steps talk about: a verified one if any, else the newest pending one. */
  email: string | null;
  /** The domain the publish step talks about: the first without a published design, else the first. */
  host: string | null;
};

/** The checklist from what exists. Null once every step is done: the card goes away by itself. */
export function setupChecklist(input: {
  addresses: { email: string; verifiedAt: number | null; createdAt: number }[];
  /** Managed domains (not removed), with when their design was last published. */
  domains: { host: string; publishedAt: number | null }[];
}): SetupChecklist | null {
  const verified = input.addresses.find((address) => address.verifiedAt !== null);
  const newest = input.addresses.toSorted((a, b) => b.createdAt - a.createdAt)[0];
  const unpublished = input.domains.find((domain) => domain.publishedAt === null);
  const steps: SetupChecklist["steps"] = [
    { id: "address", done: input.addresses.length > 0 },
    { id: "verify", done: verified !== undefined },
    { id: "domain", done: input.domains.length > 0 },
    { id: "publish", done: input.domains.some((domain) => domain.publishedAt !== null) },
  ];
  if (steps.every((step) => step.done)) return null;
  return {
    steps,
    email: (verified ?? newest)?.email ?? null,
    host: (unpublished ?? input.domains[0])?.host ?? null,
  };
}

/** The card for the overview, or null when setup is complete or the owner hid it. */
export async function loadSetupChecklist(db: Db): Promise<SetupChecklist | null> {
  if ((await getWorkspaceMark(db, "setup-checklist-dismissed")) !== null) return null;
  const [addresses, domains, published] = await Promise.all([
    listNotifyAddresses(db),
    listDomains(db),
    listPublishedAt(db),
  ]);
  const publishedByHost = new Map(published.map((row) => [row.host, row.publishedAt]));
  return setupChecklist({
    addresses,
    domains: domains.map((domain) => ({ host: domain.host, publishedAt: publishedByHost.get(domain.host) ?? null })),
  });
}
