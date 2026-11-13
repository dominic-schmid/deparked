import type { HTMLAttributes, ReactNode } from "react";
export type BadgeTone = "neutral" | "success" | "info" | "warning" | "danger";
export type BadgeSize = "sm" | "md" | "lg";
export type BadgeColor = "teal" | "sky" | "orchid" | "violet" | "rose" | "amber";
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    tone?: BadgeTone;
    size?: BadgeSize;
    icon?: ReactNode;
    /** A small status dot in the tone colour. Ignored when an icon is set. */
    dot?: boolean;
    /** Categorical colour from the shared tone family, for labels such as method tags. Overrides tone. */
    color?: BadgeColor;
    /** Draws a hairline border in the tone colour. */
    outline?: boolean;
    /** Fully rounded ends instead of the default soft corners. */
    pill?: boolean;
}
export declare function Badge({ tone, size, icon, dot, color, outline, pill, className, children, ...props }: BadgeProps): import("react").JSX.Element;
export default Badge;
