import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
/**
 * The last item a drawer showed. Pass the selected item (or null when nothing is open) and render the drawer's content
 * from the result, so the content stays on screen while the panel slides out instead of vanishing the moment it closes.
 */
export declare function useDrawerItem<T>(item: T | null | undefined): T | null | undefined;
export declare function Drawer({ open: openProp, defaultOpen, onOpenChange, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Root>): import("react").JSX.Element;
export declare const DrawerTrigger: import("react").ForwardRefExoticComponent<DialogPrimitive.DialogTriggerProps & import("react").RefAttributes<HTMLButtonElement>>;
export declare const DrawerClose: import("react").ForwardRefExoticComponent<DialogPrimitive.DialogCloseProps & import("react").RefAttributes<HTMLButtonElement>>;
export interface DrawerContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
    title: string;
    description?: string;
    children: ReactNode;
    side?: "left" | "right" | "top" | "bottom";
    /** Renders the drawer inside this element instead of the page body, anchored to its edges. The element needs position: relative and overflow: hidden. */
    container?: HTMLElement | null;
}
export declare function DrawerContent({ title, description, children, side, container, className, onInteractOutside, ...props }: DrawerContentProps): import("react").JSX.Element;
export default Drawer;
