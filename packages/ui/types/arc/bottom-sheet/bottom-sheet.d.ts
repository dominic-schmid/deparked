import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
/**
 * A sheet that rises from the bottom edge and rests at one or more heights (detents).
 * Use it for secondary tasks where a peek is useful before committing to the full view: trip details, share options, filters.
 * Use a dialog when the decision must interrupt, and a drawer for side panels on wide layouts.
 */
export interface BottomSheetProps {
    /** The control that opens the sheet, usually a button. Focus returns to it when the sheet closes. */
    trigger?: ReactNode;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    title: string;
    description?: string;
    /** Resting heights as fractions of the viewport height. The sheet opens at `initialDetent` and never grows past the largest. */
    detents?: number[];
    /** Index into the sorted detents the sheet opens at. Defaults to the smallest. */
    initialDetent?: number;
    onDetentChange?: (index: number) => void;
    closeLabel?: string;
    className?: string;
    children: ReactNode;
}
export declare function BottomSheet({ trigger, open: openProp, defaultOpen, onOpenChange, ...props }: BottomSheetProps): import("react").JSX.Element;
export declare const BottomSheetClose: import("react").ForwardRefExoticComponent<DialogPrimitive.DialogCloseProps & import("react").RefAttributes<HTMLButtonElement>>;
export default BottomSheet;
