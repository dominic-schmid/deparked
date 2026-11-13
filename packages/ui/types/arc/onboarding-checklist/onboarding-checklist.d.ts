export interface OnboardingStep {
    id: string;
    title: string;
    description?: string;
    /** Label of the button that does the step. Without it, the step is checked off by hand. */
    actionLabel?: string;
    /** Runs the step. Resolve to check it off; throw an Error to keep it open and show the error's message. */
    onAction?: () => void | Promise<void>;
}
/**
 * A getting started checklist for a new account or workspace. The ring and count follow every check, finished steps
 * strike through and fold into a completed row that opens again, and the next step opens and takes focus.
 * Use it for a short, one time setup of three to eight steps; use a step form when the order is strict.
 */
export interface OnboardingChecklistProps {
    title: string;
    /** Title once every step is done. */
    doneTitle?: string;
    steps: OnboardingStep[];
    defaultCompleted?: string[];
    onCompletedChange?: (completed: string[]) => void;
    defaultHidden?: boolean;
    onHiddenChange?: (hidden: boolean) => void;
    className?: string;
}
export declare function OnboardingChecklist({ title, doneTitle, steps, defaultCompleted, onCompletedChange, defaultHidden, onHiddenChange, className }: OnboardingChecklistProps): import("react").JSX.Element;
export default OnboardingChecklist;
