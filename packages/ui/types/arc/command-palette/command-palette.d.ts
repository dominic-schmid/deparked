import type { ReactNode } from "react";
export interface CommandItem {
    id: string;
    label: string;
    description?: string;
    group?: string;
    keywords?: string[];
    icon?: ReactNode;
    shortcut?: string;
}
export interface CommandPaletteProps {
    items: CommandItem[];
    placeholder?: string;
    onSelect?: (item: CommandItem) => void;
    onClose?: () => void;
    label?: string; /** Focus the search field on mount, for a palette that opens on demand. */
    autoFocus?: boolean;
}
export declare function CommandPalette({ items, placeholder, onSelect, onClose, label, autoFocus }: CommandPaletteProps): import("react").JSX.Element;
export default CommandPalette;
