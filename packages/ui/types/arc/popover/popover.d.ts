import { Popover as PopoverPrimitive } from "radix-ui";
export declare const Popover: import("react").FC<PopoverPrimitive.PopoverProps>;
export declare const PopoverClose: import("react").ForwardRefExoticComponent<PopoverPrimitive.PopoverCloseProps & import("react").RefAttributes<HTMLButtonElement>>;
/** The trigger anchors the panel, so it opts out of press-scale: a scaled rect measured on open would shift the panel as the trigger springs back. */
export declare const PopoverTrigger: import("react").ForwardRefExoticComponent<Omit<PopoverPrimitive.PopoverTriggerProps & import("react").RefAttributes<HTMLButtonElement>, "ref"> & import("react").RefAttributes<HTMLButtonElement>>;
export declare const PopoverContent: import("react").ForwardRefExoticComponent<Omit<PopoverPrimitive.PopoverContentProps & import("react").RefAttributes<HTMLDivElement>, "ref"> & import("react").RefAttributes<HTMLDivElement>>;
