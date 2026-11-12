/**
 * How the progress list asks again. `working`: the step continues in the next request (a long publish). `busy`:
 * another change holds the lock. Each waits between calls and gives up after a number of answers in a row.
 */
export const RETRY = {
  working: { waitMs: 400, tries: 60 },
  busy: { waitMs: 3000, tries: 40 },
} as const;

/** The wait before asking again after the `attempt`th such answer in a row, or null: stop and say so. */
export function retryWait(outcome: keyof typeof RETRY, attempt: number): number | null {
  const rule = RETRY[outcome];
  return attempt > rule.tries ? null : rule.waitMs;
}
