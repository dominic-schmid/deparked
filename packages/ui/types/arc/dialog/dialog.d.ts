import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
export declare function Dialog({ open: openProp, defaultOpen, onOpenChange, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Root>): import("react").JSX.Element;
export declare const DialogTrigger: import("react").ForwardRefExoticComponent<DialogPrimitive.DialogTriggerProps & import("react").RefAttributes<HTMLButtonElement>>;
export declare const DialogClose: import("react").ForwardRefExoticComponent<DialogPrimitive.DialogCloseProps & import("react").RefAttributes<HTMLButtonElement>>;
export interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
    title: string;
    description?: string;
    children: ReactNode;
}
export declare function DialogContent({ title, description, children, className, onPointerDownOutside, ...props }: DialogContentProps): import("react").JSX.Element;
