// No imports on purpose: the domain screens read the type, and the rule is plain data in, answer out.

/**
 * A change to a domain that stopped half-way, told apart by its status and which way its ledger moved last.
 * `adding` / `turning-on`: the domain is still off, Deparked's settings for it were being created. `turning-off`:
 * they were being removed, or only the pages were left to take down. `unclear`: both happened at the same moment.
 */
export type PendingChange = "adding" | "turning-on" | "turning-off" | "unclear";

type LedgerRow = { createdAt: number; undoneAt: number | null };

export function pendingChange(input: {
  status: string;
  turnedOffAt: number | null;
  /** The domain's whole ledger, undone entries included. */
  ledger: readonly LedgerRow[];
  /** The publish manifest still lists pages of the domain. */
  hasPages: boolean;
}): PendingChange | null {
  const active = input.ledger.filter((entry) => entry.undoneAt === null);
  const lastCreate = Math.max(-1, ...input.ledger.map((entry) => entry.createdAt));
  const lastUndo = Math.max(-1, ...input.ledger.map((entry) => entry.undoneAt ?? -1));
  const undoing = lastUndo > lastCreate;
  if (input.status !== "off") return active.length > 0 && undoing ? "turning-off" : null;
  if (active.length === 0) return input.hasPages ? "turning-off" : null;
  if (lastUndo === lastCreate) return "unclear";
  if (undoing) return "turning-off";
  return input.turnedOffAt === null ? "adding" : "turning-on";
}
