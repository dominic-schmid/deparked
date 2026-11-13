import type { HTMLAttributes, ReactNode } from "react";
export interface RadioCardOption {
    value: string;
    label: ReactNode;
    /** One or two short lines under the label. */
    description?: ReactNode;
    /** A price, estimate, or other value. Sits at the end of a list row, or under the text in a grid card. */
    meta?: ReactNode;
    /** Plain decorative icon beside the label. */
    icon?: ReactNode;
    disabled?: boolean;
    /** Short reason shown in place of the description when the option is disabled. */
    disabledReason?: ReactNode;
}
/**
 * Selectable option cards for choices that need more than a label: plans, shipping speeds, regions. One selection ring
 * glides from card to card on a spring, so the eye follows the change. Behaves as a native radio group: one tab stop,
 * arrow keys move and select, and a hidden input carries the value in forms.
 */
export interface RadioCardsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
    options: RadioCardOption[];
    value?: string | null;
    defaultValue?: string | null;
    onValueChange?: (value: string) => void;
    /** "grid" places cards in responsive columns; "list" stacks full width rows. */
    layout?: "grid" | "list";
    /** Narrowest a grid column may get before the grid drops a column, in px. */
    minColumnWidth?: number;
    /** Form field name. Renders a hidden input with the selected value. */
    name?: string;
    required?: boolean;
    disabled?: boolean;
}
export declare const RadioCards: import("react").ForwardRefExoticComponent<RadioCardsProps & import("react").RefAttributes<HTMLDivElement>>;
export default RadioCards;
