import type { ButtonHTMLAttributes, ReactNode } from "react";
/**
 * A button that commits only after it is held, for destructive or hard to undo actions where a stray tap must not count. A fill tracks the hold on a
 * linear timeline; letting go early rewinds it on a spring, and finishing morphs the label and icon into a done state. Space and Enter can be held too.
 * Prefer a regular confirmation dialog when people need to read consequences first; use this when the consequence is already on screen.
 */
export interface HoldToConfirmProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "onDrag" | "onDragEnd" | "onDragStart" | "onAnimationStart" | "onAnimationEnd"> {
    /** The instruction and the action, for example “Hold to delete project”. */
    label: string;
    /** Shown once the hold completes, for example “Deleted”. */
    confirmedLabel?: string;
    /** Called once when the hold completes. */
    onConfirm: () => void;
    /** Hold length in milliseconds. */
    duration?: number;
    icon?: ReactNode;
    /** `accent` (default) fills with the selected accent; `danger` is for an irreversible action; `neutral` fills with the foreground. */
    tone?: "accent" | "danger" | "neutral";
    /** Controls the done state. Set it back to false to reset the button; leave it undefined to let the button keep its own state. */
    confirmed?: boolean;
    /** Reports when a hold starts and ends, for surrounding hints such as “Keep holding”. */
    onHoldChange?: (holding: boolean) => void;
}
export declare function HoldToConfirm({ label, confirmedLabel, onConfirm, duration, icon, tone, confirmed, onHoldChange, className, disabled, ...props }: HoldToConfirmProps): import("react").JSX.Element;
export default HoldToConfirm;
