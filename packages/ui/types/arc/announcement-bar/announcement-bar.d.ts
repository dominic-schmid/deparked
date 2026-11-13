import type { ReactNode } from "react";
export interface AnnouncementAction {
    label: string;
    href?: string;
    onClick?: () => void;
}
export interface Announcement {
    /** Stable id, reported to callbacks. */
    id: string;
    message: ReactNode;
    action?: AnnouncementAction;
    /** Counts down to a moment, for example the end of a sale. */
    countdown?: {
        to: Date | string | number;
        label?: string;
    };
}
/**
 * A slim bar for the top of a page. It can rotate several messages, each rising in from below while the bar springs to
 * the new height; rotation pauses on hover, focus, or a hidden tab, and `controls` adds previous, next, and a pause ring. Messages can carry a
 * call to action and a live countdown. Dismissing collapses the height smoothly so the page below eases up, and with an
 * `id` the dismissal is remembered in `localStorage`.
 */
export interface AnnouncementBarProps {
    messages: Announcement[];
    /** Remembers dismissal under this id. Change the id to show a new campaign to everyone again. */
    id?: string;
    /** Whether the bar is shown. Leave it out to let the component manage it. */
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Index of the visible message. */
    index?: number;
    defaultIndex?: number;
    onIndexChange?: (index: number) => void;
    /** Milliseconds each message stays before the next one. Defaults to 6000. */
    interval?: number;
    /** Rotate automatically. Pauses on hover, focus, or a hidden tab, and is turned off when the visitor prefers reduced motion. Defaults to true. */
    autoPlay?: boolean;
    /** Show previous, next, and pause controls when there are several messages. Defaults to false: only the close button shows. */
    controls?: boolean;
    dismissible?: boolean;
    tone?: "neutral" | "inverted";
    onAction?: (announcement: Announcement) => void;
    onCountdownEnd?: (announcement: Announcement) => void;
    /** Accessible name of the region. */
    label?: string;
    className?: string;
}
/** Forgets a remembered dismissal so the bar with this id shows again. */
export declare function clearAnnouncementDismissal(id: string): void;
export declare const AnnouncementBar: import("react").ForwardRefExoticComponent<AnnouncementBarProps & import("react").RefAttributes<HTMLElement>>;
export default AnnouncementBar;
