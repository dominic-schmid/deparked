import type { ReactNode } from "react";
export interface DropdownItem {
    label: string;
    onSelect?: () => void;
    disabled?: boolean;
    icon?: ReactNode;
    destructive?: boolean;
    separatorBefore?: boolean;
}
export interface DropdownMenuProps {
    label: string;
    items: DropdownItem[];
    icon?: ReactNode;
}
export declare function DropdownMenu({ label, items, icon }: DropdownMenuProps): import("react").JSX.Element;
export default DropdownMenu;
