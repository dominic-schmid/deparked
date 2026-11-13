import type { HTMLAttributes, ReactNode } from "react";
export interface CardProps extends HTMLAttributes<HTMLElement> {
    title: string;
    description?: string;
    media?: ReactNode;
    action?: ReactNode;
    /** A small leading visual for the footer, such as the owner's avatar. */
    avatar?: ReactNode;
    /** Who the card belongs to, such as the owner's name. */
    meta?: ReactNode;
    /** A short status under the meta, such as "Updated 2 hours ago". Changed words rise in and are announced politely. */
    status?: string;
    /** Content for a quick look. When set, the whole card opens and grows into a larger view; Escape or the close control morphs it back. */
    details?: ReactNode;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
}
export declare function Card({ title, description, media, action, avatar, meta, status, details, open: openProp, defaultOpen, onOpenChange, children, className, style, ...props }: CardProps): import("react").JSX.Element;
