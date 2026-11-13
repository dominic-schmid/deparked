import type { ReactNode } from "react";
export interface FilterChip {
    id: string;
    label: string;
    value?: string;
}
/** One value a field can take. `hint` sits at the end of the row, for example a count. */
export interface FilterOption {
    value: string;
    label?: string;
    hint?: string | number;
    icon?: ReactNode;
}
export interface FilterField {
    id: string;
    label: string;
    icon?: ReactNode;
    options: (string | FilterOption)[];
}
export interface FilterMenuProps {
    fields: FilterField[];
    /** Receives a chip whose id is the field id, so a second pick for a field replaces the first. */
    onSelect: (filter: FilterChip, field: FilterField) => void;
    /** Applied filters. Each field shows its current value and the value step marks it. */
    active?: FilterChip[];
    label?: string;
    /** The trigger edge the panel lines up with. It flips or shifts when the viewport, or a clipping ancestor, has no room. */
    align?: "start" | "end";
}
export interface FilterToolbarProps {
    filters: FilterChip[];
    onRemove: (id: string) => void;
    onClearAll?: () => void;
    children?: ReactNode;
    label?: string;
    /** Adds an Add filter trigger that morphs into a two step field and value menu. */
    addFilter?: {
        fields: FilterField[];
        onAdd: (filter: FilterChip, field: FilterField) => void;
        label?: string;
        align?: "start" | "end";
    };
}
/** An Add filter button that grows into its own menu: pick a field, then a value. The shape springs between the
 *  button and the panel, and the panel renders in place, so keep its ancestors free of overflow clipping. */
export declare function FilterMenu({ fields, onSelect, active, label, align }: FilterMenuProps): import("react").JSX.Element;
export declare function FilterToolbar({ filters, onRemove, onClearAll, children, label, addFilter }: FilterToolbarProps): import("react").JSX.Element;
export default FilterToolbar;
