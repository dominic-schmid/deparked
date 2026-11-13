import type { ComponentPropsWithoutRef, ReactNode } from "react";
export interface ExpandableCardProps extends Omit<ComponentPropsWithoutRef<"article">, "title" | "children" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration" | "onDrag" | "onDragStart" | "onDragEnd" | "onDragOver" | "onDragLeave" | "onDragEnter" | "onDragExit" | "onDrop"> {
    title: string;
    description?: string;
    children: ReactNode;
    defaultExpanded?: boolean;
    /** Collapsed width cap in px. The card is centered and never wider than its container. Fills the container when omitted. */
    width?: number;
    /** Expanded width cap in px, so the card can grow sideways into more room. Defaults to `width`. */
    expandedWidth?: number;
}
export declare function ExpandableCard({ title, description, children, defaultExpanded, width, expandedWidth, className, style, onKeyDown, ...rest }: ExpandableCardProps): import("react").JSX.Element;
export default ExpandableCard;
