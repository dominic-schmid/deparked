import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentPropsWithoutRef } from "react";
export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
    label?: string;
}
export declare const Switch: import("react").ForwardRefExoticComponent<SwitchProps & import("react").RefAttributes<HTMLButtonElement>>;
export default Switch;
