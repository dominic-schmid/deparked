import type { InputHTMLAttributes } from "react";
export interface ComboboxOption {
    value: string;
    label: string;
    disabled?: boolean;
    keywords?: string[];
}
export interface ComboboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "placeholder"> {
    label: string;
    options: ComboboxOption[];
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    description?: string;
    placeholder?: string;
    emptyMessage?: string;
    className?: string;
}
export declare const Combobox: import("react").ForwardRefExoticComponent<ComboboxProps & import("react").RefAttributes<HTMLInputElement>>;
