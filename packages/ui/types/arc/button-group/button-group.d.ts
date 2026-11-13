import type { CSSProperties, ReactNode } from "react";
export type ButtonGroupVariant = "outline" | "solid";
export type ButtonGroupSize = "sm" | "md";
export type ButtonGroupOrientation = "horizontal" | "vertical";
export interface ButtonGroupItem {
    /** Stable key for the segment. */
    id: string;
    /** Visible text and the accessible name. Changing it crossfades in place, so "Share" can answer "Copied". */
    label: string;
    /** Every other label this segment can show, such as ["Copied"]. The segment sizes to the widest, so a label change never resizes it. */
    reserve?: string[];
    icon?: ReactNode;
    /** Shows only the icon; the label becomes the accessible name and the tooltip. */
    iconOnly?: boolean;
    /** Visible content in place of the label, such as a live value. The label stays the accessible name. */
    content?: ReactNode;
    onSelect?: () => void;
    /** Renders the segment as a link. */
    href?: string;
    disabled?: boolean;
}
export interface ButtonGroupMenuItem {
    id: string;
    label: string;
    icon?: ReactNode;
    onSelect?: () => void;
    href?: string;
    disabled?: boolean;
    /** Colors the item as a destructive action. */
    destructive?: boolean;
}
export interface ButtonGroupMenu {
    /** Accessible name and tooltip of the chevron segment, such as "More actions". */
    label: string;
    items: ButtonGroupMenuItem[];
}
export interface ButtonGroupProps {
    items: ButtonGroupItem[];
    /** Adds a trailing chevron segment that opens these actions in a menu aligned to the group's edge. */
    menu?: ButtonGroupMenu;
    /** Accessible name of the group, such as "Document actions". */
    label: string;
    variant?: ButtonGroupVariant;
    size?: ButtonGroupSize;
    orientation?: ButtonGroupOrientation;
    /** When the row does not fit its container, segments with an icon drop their label and keep the icon. Horizontal only. */
    collapseLabels?: boolean;
    /** Disables every segment and the menu. */
    disabled?: boolean;
    className?: string;
    style?: CSSProperties;
}
/**
 * Related actions joined into one surface: a shared border and radius, hairline dividers, no gaps. One soft highlight glides
 * between segments under the pointer or keyboard focus, the pressed segment answers in place, and an optional chevron
 * segment opens more actions in a menu aligned to the group's edge.
 */
export declare function ButtonGroup({ items, menu, label, variant, size, orientation, collapseLabels, disabled, className, style }: ButtonGroupProps): import("react").JSX.Element;
export default ButtonGroup;
