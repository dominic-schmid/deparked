import type { ReactNode } from "react";
export interface TimelineEvent {
    id: string;
    /** When it happened, as an ISO string or epoch milliseconds. */
    at: string | number;
    /** Who did it, shown first in the foreground color. */
    actor?: string;
    /** What happened, completing the actor: "merged Checkout redesign into main". */
    title: string;
    /** Short context under the title, such as a pull request or a build. */
    meta?: string;
    /** Revealed in place when the row is expanded. Rows without detail are not interactive. */
    detail?: ReactNode;
    /** Portrait for an event by a person. */
    avatar?: string;
    /** Icon for a system event, used when there is no avatar. */
    icon?: ReactNode;
    /** Status of a system event. Always say the outcome in the title too, so it never rests on color. */
    tone?: "neutral" | "success" | "danger";
}
/**
 * A vertical activity feed grouped by day, for project history, audit logs, and deploy streams. Use it when order and
 * recency matter; use a table when people need to sort or compare. Day labels stay pinned while their updates scroll,
 * the connecting line draws itself as rows come into view, rows expand in place, and new updates slide in at the top
 * while the rest glide down. Arrow keys move between rows, Enter or Space expands one.
 */
export interface TimelineProps {
    /** Updates in any order; the newest shows first. */
    events: TimelineEvent[];
    /** Reference time for relative labels and day groups, in epoch milliseconds. Pass a ticking clock to keep labels fresh. */
    now: number;
    /** Accessible name for the feed. */
    label: string;
    /** Time zone for day groups and clock times. Fixed by default so server and client agree. */
    timeZone?: string;
    locale?: string;
    /** Height of the scrolling area. Without it the feed grows with the page and reveals on page scroll. */
    maxHeight?: number | string;
    /** Scroll back to the top when a new update arrives while the feed is scrolled down. */
    scrollToNew?: boolean;
    defaultExpanded?: string[];
    /** Heading level for the day labels. */
    headingLevel?: 2 | 3 | 4 | 5 | 6;
    className?: string;
}
export declare function Timeline({ events, now, label, timeZone, locale, maxHeight, scrollToNew, defaultExpanded, headingLevel, className }: TimelineProps): import("react").JSX.Element;
export default Timeline;
