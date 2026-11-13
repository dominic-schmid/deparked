import type { ReactNode } from "react";
export interface ExpandingSearchItem {
    id: string;
    title: string;
    /** One short line under the title, such as the type, owner, or last edit. */
    meta?: string;
    /** Results gather under this heading, in the order groups first appear in `items`. */
    group?: string;
    icon?: ReactNode;
    /** Extra words that should also find this item. */
    keywords?: string[];
}
/**
 * A search that waits as an icon button until it is needed. Use it in headers and toolbars where a full field would crowd the layout.
 * The button morphs into the field, results unfold beneath it, and Escape, choosing a result, or leaving the field empty folds it back into the icon.
 * Place it in the space the field may grow into; it fills that space's width and keeps the button on the `anchor` edge, or centered in it.
 */
export interface ExpandingSearchProps {
    /** Names the button, the field, and the results, such as "Search projects and docs". */
    label: string;
    items: ExpandingSearchItem[];
    /** Shown before anything is typed, such as recent searches. */
    suggestions?: ExpandingSearchItem[];
    suggestionsLabel?: string;
    placeholder?: string;
    onSelect?: (item: ExpandingSearchItem) => void;
    onExpandedChange?: (expanded: boolean) => void;
    /** The widest the field grows. It never grows past its container. */
    expandedWidth?: number;
    maxResults?: number;
    /** Where the button sits: on the start or end edge, growing away from it, or in the middle, growing evenly to both sides. */
    anchor?: "start" | "center" | "end";
    /** A short tip under the empty state. */
    emptyHint?: string;
    className?: string;
}
export declare function ExpandingSearch({ label, items, suggestions, suggestionsLabel, placeholder, onSelect, onExpandedChange, expandedWidth, maxResults, anchor, emptyHint, className }: ExpandingSearchProps): import("react").JSX.Element;
export default ExpandingSearch;
