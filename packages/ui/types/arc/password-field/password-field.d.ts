import type { InputHTMLAttributes } from "react";
/** The toggle's names. Both have English defaults; pass the ones you translate. */
export interface PasswordFieldMessages {
    showPassword: string;
    hidePassword: string;
}
export declare const defaultPasswordFieldMessages: PasswordFieldMessages;
export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
    label: string;
    description?: string;
    /** Translated or reworded toggle names. */
    messages?: Partial<PasswordFieldMessages>;
}
export declare const PasswordField: import("react").ForwardRefExoticComponent<PasswordFieldProps & import("react").RefAttributes<HTMLInputElement>>;
