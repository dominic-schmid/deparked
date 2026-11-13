import type { ReactElement, ReactNode } from "react";
/**
 * A rich preview of a person or link that opens after a short hover or keyboard focus, for mentions, avatars, and references where a click should stay free for navigation.
 * It waits half a second, opens almost at once when moving between triggers, stays open while the pointer travels into it, and closes fast on leave or Escape.
 * On touch, a tap toggles it. Keep the content read only; anything actionable belongs behind the trigger itself.
 */
export interface HoverCardProps {
    /** The trigger, such as a mention button or a link. It must accept a ref and be focusable. */
    children: ReactElement;
    /** The preview. `HoverCardProfile` covers people; any read only content works. */
    content: ReactNode;
    side?: "top" | "bottom" | "left" | "right";
    align?: "start" | "center" | "end";
    /** Milliseconds of hover before the first card opens. */
    openDelay?: number;
    /** Milliseconds of grace after the pointer leaves, so it can travel into the card. */
    closeDelay?: number;
    className?: string;
}
export declare function HoverCard({ children, content, side, align, openDelay, closeDelay, className }: HoverCardProps): import("react").JSX.Element;
export interface HoverCardStat {
    label: string;
    value: string | number;
}
/** A person preview for `HoverCard`: portrait, name, role, a short bio, a couple of numbers, and a quiet footer line. Its rows settle in with a tiny stagger. */
export interface HoverCardProfileProps {
    name: string;
    /** Role and team, such as "Product designer, Payments". */
    role?: string;
    /** A portrait URL, or your own image element such as next/image. Initials show when it is missing. */
    avatar?: string | ReactNode;
    bio?: string;
    stats?: HoverCardStat[];
    /** A footer line, such as a location and local time. */
    meta?: ReactNode;
}
export declare function HoverCardProfile({ name, role, avatar, bio, stats, meta }: HoverCardProfileProps): import("react").JSX.Element;
export default HoverCard;
