import type { ButtonHTMLAttributes, ReactNode } from "react";
export type ToggleGroupSize = "sm" | "md";
interface ToggleGroupBase {
    children: ReactNode;
    /** Accessible name of the group, such as "Text style" or "Alignment". */
    label: string;
    size?: ToggleGroupSize;
    disabled?: boolean;
    className?: string;
}
export interface ToggleGroupSingleProps extends ToggleGroupBase {
    /** One option at most is pressed. Choosing another moves the pressed state across; the pressed option stays pressed. */
    type?: "single";
    value?: string | null;
    defaultValue?: string | null;
    onValueChange?: (value: string) => void;
}
export interface ToggleGroupMultipleProps extends ToggleGroupBase {
    /** Each option toggles on its own. */
    type: "multiple";
    value?: readonly string[];
    defaultValue?: readonly string[];
    onValueChange?: (value: string[]) => void;
}
export type ToggleGroupProps = ToggleGroupSingleProps | ToggleGroupMultipleProps;
export interface ToggleGroupItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value" | "type"> {
    value: string;
    /** Accessible name, required when the item shows only an icon. Also used as the tooltip title unless title is set. */
    label?: string;
    children: ReactNode;
}
/**
 * A row of toggle buttons. In single mode one pressed fill glides from option to option; in multiple mode each fill fades in
 * on its own and neighbours that are both on join into one shape. Arrow keys move focus, Space and Enter toggle.
 */
export declare function ToggleGroup(props: ToggleGroupProps): import("react").JSX.Element;
export declare namespace ToggleGroup {
    export { ToggleGroupItem as Item };
}
export declare function ToggleGroupItem({ value, label, children, disabled: itemDisabled, className, title, onClick, onFocus, ...rest }: ToggleGroupItemProps): import("react").JSX.Element;
export default ToggleGroup;
