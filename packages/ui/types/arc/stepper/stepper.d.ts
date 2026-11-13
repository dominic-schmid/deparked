export type StepperOrientation = "horizontal" | "vertical";
export type StepperStatus = "complete" | "current" | "upcoming" | "error";
export interface StepperStep {
    /** Stable key, so each step keeps its own motion when the list changes. */
    id: string;
    label: string;
    /** A short hint under the label. */
    description?: string;
    /** Marks the step as failed: the marker morphs into an alert and this message replaces the description. */
    error?: string;
}
/**
 * A steps indicator for onboarding, checkout, and setup flows. Place it above (horizontal) or beside (vertical) the step
 * content and drive it with `current`; set `current` to `steps.length` once every step is done. Pass `onStepSelect` to let
 * people return to completed steps by click or keyboard. For a multi-step form that owns its own content, use MultiStepForm.
 */
export interface StepperProps {
    steps: StepperStep[];
    /** Index of the step in progress. `steps.length` marks the whole flow complete. */
    current: number;
    orientation?: StepperOrientation;
    /** Called with the index of a completed step when it is chosen. Without it the stepper is a read-only indicator. */
    onStepSelect?: (index: number) => void;
    /** `current` shows only the active step's description, for tight spaces. Errors always show. */
    details?: "all" | "current";
    /** Markers only; labels stay available to assistive tech. Horizontal steppers switch to this below 30rem on their own
     *  and show the current step's label underneath. */
    compact?: boolean;
    /** Accessible name for the stepper. */
    label?: string;
    /** Announced, and shown in the compact caption, once every step is complete. */
    completeLabel?: string;
    className?: string;
}
export declare function Stepper({ steps, current, orientation, onStepSelect, details, compact, label, completeLabel, className }: StepperProps): import("react").JSX.Element;
export default Stepper;
