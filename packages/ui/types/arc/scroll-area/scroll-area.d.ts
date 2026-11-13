import type { CSSProperties, HTMLAttributes, ReactNode, Ref, UIEvent } from "react";
/** Which edges still have content beyond them. */
export interface ScrollAreaEdges {
    top: boolean;
    bottom: boolean;
    left: boolean;
    right: boolean;
}
/**
 * A native scroll container with thin overlay scrollbars that appear while scrolling or on hover and fade away at rest.
 * Each edge fades out only when there is more content beyond it, in proportion to how much. Scrolling stays native, so
 * keyboard, touch momentum, and scroll snap all behave as the platform expects.
 */
export interface ScrollAreaProps extends Omit<HTMLAttributes<HTMLDivElement>, "onScroll"> {
    children?: ReactNode;
    /** Axes that scroll. Defaults to vertical. */
    orientation?: "vertical" | "horizontal" | "both";
    /** Length of the edge fade in px. 0 turns the fades off. */
    fade?: number;
    /** "auto" shows scrollbars while scrolling or hovering; "always" keeps them visible when content overflows. */
    scrollbars?: "auto" | "always";
    /** How long scrollbars linger after scrolling stops, in ms. */
    hideDelay?: number;
    /** Maximum height of the viewport, for vertical areas that should grow with their content. */
    maxHeight?: CSSProperties["maxHeight"];
    /** Passed to the viewport's `scroll-snap-type`, for example "x mandatory". Children set their own `scroll-snap-align`. */
    snap?: CSSProperties["scrollSnapType"];
    /** Accessible name. The viewport becomes a labelled, focusable region that arrow and page keys scroll. */
    label?: string;
    /** Turns vertical wheel movement into horizontal scrolling for horizontal areas. Defaults to true. */
    wheelToHorizontal?: boolean;
    viewportClassName?: string;
    viewportStyle?: CSSProperties;
    viewportRef?: Ref<HTMLDivElement>;
    onScroll?: (event: UIEvent<HTMLDivElement>) => void;
    /** Called when content starts or stops extending past an edge. */
    onEdgeChange?: (edges: ScrollAreaEdges) => void;
}
export declare const ScrollArea: import("react").ForwardRefExoticComponent<ScrollAreaProps & import("react").RefAttributes<HTMLDivElement>>;
export default ScrollArea;
