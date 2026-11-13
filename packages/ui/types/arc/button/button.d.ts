import type { ButtonHTMLAttributes } from "react";
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragEnd" | "onDragStart" | "onAnimationStart"> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
}
export declare const Button: import("react").ForwardRefExoticComponent<ButtonProps & import("react").RefAttributes<HTMLButtonElement>>;
export default Button;
