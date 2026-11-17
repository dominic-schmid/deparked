import type { DomainPreview, DomainToday, SetupStepPreview } from "@deparked/hosting";

/** The look at a domain while it runs: the steps once they are known, and what has answered so far. */
export type Look = {
  steps: readonly { id: string; title: string }[] | null;
  today: DomainToday | null;
  checked: ReadonlyMap<string, SetupStepPreview>;
};

export const LOOK_START: Look = { steps: null, today: null, checked: new Map() };

/** The finished look as one preview, or null while an answer is missing. */
export function assembleLook(look: Look): DomainPreview | null {
  if (look.steps === null || look.today === null) return null;
  const steps: SetupStepPreview[] = [];
  for (const { id } of look.steps) {
    const step = look.checked.get(id);
    if (step === undefined) return null;
    steps.push(step);
  }
  return {
    ...look.today,
    steps,
    // Moving the mail stays on offer for a domain that kept its own, so it can be done after the add.
    nothingToDo: steps.every((step) => step.status === "done") && !look.today.asks.includes("replaceExistingMx"),
  };
}
