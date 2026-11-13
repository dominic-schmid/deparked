import type { HTMLAttributes, ReactNode } from "react";
/**
 * Long text clamped to a few lines with a soft fade over the last one. Read more opens it to its full height with a calm ease out,
 * and Show less closes it again, bringing the start of the text back into view when it had scrolled away. The toggle only appears when the text
 * really overflows its lines, and stays correct as the width or font changes.
 */
export interface ExpandableTextProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
    /** The text. Plain strings, paragraphs, and inline links all work; the whole text stays available to screen readers while clamped. */
    children: ReactNode;
    /** How many lines show while collapsed. */
    lines?: number;
    /** Controlled open state. */
    expanded?: boolean;
    defaultExpanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
    /** Toggle label while collapsed. */
    moreLabel?: string;
    /** Toggle label while open. */
    lessLabel?: string;
}
export declare function ExpandableText({ children, lines, expanded: expandedProp, defaultExpanded, onExpandedChange, moreLabel, lessLabel, className, style, ...props }: ExpandableTextProps): import("react").JSX.Element;
export default ExpandableText;
