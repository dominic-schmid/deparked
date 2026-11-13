export interface ChipOption {
    value: string;
    label: string;
}
/**
 * Selectable filter chips for narrowing a list by facets people toggle often, such as topics, statuses, or tags.
 * Selecting morphs the chip: a check grows in, the label slides over, and the chip's edge follows on a spring while its
 * neighbours glide to their new places, even across lines. Long sets fold behind a “+N more” chip that opens with a height morph.
 * Arrow keys move between chips, Space or Enter toggles, and each chip is a pressed or unpressed button.
 */
export interface ChipGroupProps {
    options: ChipOption[];
    value: string[];
    onValueChange: (value: string[]) => void;
    /** Accessible name of the group, such as “Topics”. */
    label: string;
    /** Allow several chips at once. In single mode the selected chip can still be cleared. */
    multiple?: boolean;
    /** Chips shown before the rest fold behind a “+N more” chip. Chips selected when it folds stay in view. */
    maxVisible?: number;
    className?: string;
}
export declare function ChipGroup({ options, value, onValueChange, label, multiple, maxVisible, className }: ChipGroupProps): import("react").JSX.Element;
export default ChipGroup;
