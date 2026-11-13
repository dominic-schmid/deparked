import type { ReactNode } from "react";
export interface ContextMenuItem {
    id: string;
    label: string;
    icon?: ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
    destructive?: boolean;
    checked?: boolean;
}
export interface ContextMenuProps {
    children: ReactNode;
    items: ContextMenuItem[];
    label?: string;
}
export declare function ContextMenu({ children, items, label }: ContextMenuProps): import("react").JSX.Element;
export declare const contextMenuExampleItems: ContextMenuItem[];
export default ContextMenu;
