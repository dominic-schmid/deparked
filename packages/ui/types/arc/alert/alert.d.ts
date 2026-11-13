import type { HTMLAttributes, ReactNode } from "react";
export type AlertTone = "info" | "success" | "warning" | "danger";
export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
    tone?: AlertTone;
    title: string;
    children?: ReactNode;
    /** Controls presence. Hiding the alert collapses its height and fades it out. */
    open?: boolean;
    /** Shows a dismiss button. An uncontrolled alert collapses first, then calls this. */
    onDismiss?: () => void;
}
export declare function Alert({ open, onDismiss, ...props }: AlertProps): import("react").JSX.Element;
export default Alert;
