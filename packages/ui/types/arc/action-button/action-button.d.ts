import type { ButtonHTMLAttributes } from "react";
export interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "onDrag" | "onDragEnd" | "onDragStart" | "onAnimationStart"> {
    label: string;
    successLabel?: string;
    pendingLabel?: string;
    onAction: () => void | Promise<void>;
    resetAfterMs?: number;
    onActionError?: (error: unknown) => void;
}
export declare function ActionButton({ label, successLabel, pendingLabel, onAction, resetAfterMs, onActionError, className, disabled, ...props }: ActionButtonProps): import("react").JSX.Element;
export default ActionButton;
