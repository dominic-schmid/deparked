import type { ReactNode } from "react";
export interface SplitButtonAction {
    label: string;
    onSelect?: () => void;
    disabled?: boolean;
    destructive?: boolean;
    icon?: ReactNode;
}
export interface SplitButtonProps {
    label: string;
    actions: SplitButtonAction[];
    onClick?: () => void;
    disabled?: boolean;
    icon?: ReactNode;
    variant?: "primary" | "secondary";
}
/** The main action morphs its icon and label in place while its width follows on a spring; the menu half never scales, so the menu opens from a still anchor. */
export declare function SplitButton({ label, actions, onClick, disabled, icon, variant }: SplitButtonProps): import("react").JSX.Element;
export default SplitButton;
