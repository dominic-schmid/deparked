import { type ReactNode } from "react";
export interface EmptyStateProps {
    title: string;
    description: string;
    action?: ReactNode;
    icon?: ReactNode;
    className?: string;
    /** Optional accessible label for the state region. */
    label?: string;
}
export declare function EmptyState({ title, description, action, icon, className, label }: EmptyStateProps): import("react").JSX.Element;
export default EmptyState;
