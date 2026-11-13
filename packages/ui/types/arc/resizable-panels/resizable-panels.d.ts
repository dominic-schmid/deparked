import type { ReactNode } from "react";
/** One pane of a `ResizablePanels` group. It only carries configuration; the group renders it. */
export interface ResizablePanelProps {
    /** Stable id, also used by the dividers' `aria-controls`. */
    id: string;
    /** Names the pane for its divider, for example "Folders". */
    label: string;
    /** Starting share of the group. Shares are relative, so they need not add up to 100. */
    defaultSize: number;
    /** Width in px where the pane starts to resist. Its content never reflows below it; it clips and fades instead. */
    minSize?: number;
    maxSize?: number;
    /** Dragging well past the minimum, or flicking toward the edge, snaps the pane closed. Its divider then shows a restore tab. */
    collapsible?: boolean;
    defaultCollapsed?: boolean;
    className?: string;
    children?: ReactNode;
}
/**
 * A horizontal split view whose panes people resize by dragging the dividers between them, the way a mail or code editor window works.
 * Use it when people need to trade space between side-by-side content for the task at hand. Dividers follow the pointer 1:1, resist past
 * a pane's limits, and snap collapsible panes closed. Each divider is a focusable separator: arrows resize, Home and End jump to the limits,
 * Enter hides or restores a collapsible pane, and a double-click resets the layout. The group needs a definite height.
 */
export interface ResizablePanelsProps {
    /** Names the group for assistive technology. */
    label?: string;
    /** `ResizablePanel` elements, in order. The set of panes should stay the same for the life of the group. */
    children: ReactNode;
    /** Called with each pane's share in percent after a resize settles. */
    onLayoutChange?: (sizes: number[]) => void;
    className?: string;
}
/** Carries a pane's configuration into `ResizablePanels`. Rendered on its own it shows its children unchanged. */
export declare function ResizablePanel({ children }: ResizablePanelProps): import("react").JSX.Element;
export declare function ResizablePanels({ label, children, onLayoutChange, className }: ResizablePanelsProps): import("react").JSX.Element;
export default ResizablePanels;
