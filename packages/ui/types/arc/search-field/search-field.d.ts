import type { InputHTMLAttributes } from "react";
export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
    label: string;
    value: string;
    onValueChange: (value: string) => void;
}
export declare const SearchField: import("react").ForwardRefExoticComponent<SearchFieldProps & import("react").RefAttributes<HTMLInputElement>>;
