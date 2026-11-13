import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ComponentPropsWithoutRef } from "react";
export interface CheckboxProps extends ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
    label?: string;
    description?: string;
}
export declare const Checkbox: import("react").ForwardRefExoticComponent<CheckboxProps & import("react").RefAttributes<HTMLButtonElement>>;
