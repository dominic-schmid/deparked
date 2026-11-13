import type { MouseEvent } from "react";
export interface BreadcrumbItem {
    label: string;
    href?: string;
    /** Runs when the crumb is chosen. Without an href the crumb renders as a button, for paths that live in local state. */
    onClick?: (event: MouseEvent<HTMLElement>) => void;
}
export interface BreadcrumbProps {
    items: BreadcrumbItem[];
    ariaLabel?: string;
}
/** Crumbs present on first render stay still; crumbs added later slide in from the path before them. */
export declare function Breadcrumb({ items, ariaLabel }: BreadcrumbProps): import("react").JSX.Element;
