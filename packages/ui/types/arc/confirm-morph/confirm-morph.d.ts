import type { ReactNode, Ref } from "react";
/** Where the control is in its life: resting, asking, working, finished, or failed. */
export type ConfirmMorphState = "idle" | "confirming" | "pending" | "done" | "error";
/** How the question is answered: a press, a press held until the fill completes, or a press followed by a short countdown. */
export type ConfirmMorphMode = "press" | "hold" | "countdown";
/**
 * A button for destructive or important actions that asks in place. Pressing it morphs the same pill into an inline question
 * with Cancel and Confirm, then into a spinner, then into a result with Undo. The width springs to each face while the faces
 * crossfade at their natural width, so text never squashes and nothing around the control jumps. Escape, an outside press,
 * or the timeout all return it to rest.
 * Use it where a modal dialog would be heavy: deleting a project, revoking access, discarding a draft.
 */
export interface ConfirmMorphProps {
    /** The resting label, such as "Delete project". */
    label: ReactNode;
    /** A plain icon before the resting label. */
    icon?: ReactNode;
    /** The question shown while confirming, such as "Delete 3 files?". Defaults to the label with a question mark. */
    prompt?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Shown beside the spinner while `onConfirm` resolves. */
    pendingLabel?: string;
    doneLabel?: string;
    errorLabel?: string;
    retryLabel?: string;
    undoLabel?: string;
    /** Shown beside the spinner while `onUndo` resolves. */
    undoingLabel?: string;
    /**
     * `danger` (default) gives the confirm button the danger colour, for actions that destroy something. `neutral` gives it the
     * accent, for important actions that can be reversed. The resting button is neutral either way.
     */
    tone?: "danger" | "neutral";
    /** `press` confirms on a press. `hold` asks for a press held for `holdDuration`. `countdown` confirms, then counts down `countdown` seconds that Cancel or Escape can still stop. */
    confirmMode?: ConfirmMorphMode;
    /** Milliseconds the confirm button must be held in `hold` mode. */
    holdDuration?: number;
    /** Seconds counted down before the action runs in `countdown` mode. */
    countdown?: number;
    /** Text before the seconds in `countdown` mode, such as "Deleting in". Defaults to the pending label followed by "in". */
    countdownLabel?: string;
    /** Runs on confirm. Return a promise to show the pending face; a rejection shows the error face with Retry. */
    onConfirm?: () => void | Promise<unknown>;
    /** Offering it adds Undo to the result. Return a promise to show a pending face while it runs. */
    onUndo?: () => void | Promise<unknown>;
    onCancel?: () => void;
    /** Controlled state. Pair it with `onStateChange`. */
    state?: ConfirmMorphState;
    /** Starting state when uncontrolled. */
    defaultState?: ConfirmMorphState;
    onStateChange?: (state: ConfirmMorphState) => void;
    /** Milliseconds before an unanswered question returns to rest. Resting the pointer on the control pauses it. 0 turns it off. */
    confirmTimeout?: number;
    /** Milliseconds a result stays before returning to rest. Resting the pointer on the control pauses it. 0 turns it off. */
    resultTimeout?: number;
    /** A press outside the control cancels an open question. Defaults to true. */
    cancelOnOutsidePress?: boolean;
    disabled?: boolean;
    className?: string;
    /** Receives the root element, which also takes focus while the action is pending. */
    ref?: Ref<HTMLDivElement>;
}
export declare function ConfirmMorph({ label, icon, prompt, confirmLabel, cancelLabel, pendingLabel, doneLabel, errorLabel, retryLabel, undoLabel, undoingLabel, tone, confirmMode, holdDuration, countdown, countdownLabel, onConfirm, onUndo, onCancel, state: stateProp, defaultState, onStateChange, confirmTimeout, resultTimeout, cancelOnOutsidePress, disabled, className, ref, }: ConfirmMorphProps): import("react").JSX.Element;
export default ConfirmMorph;
