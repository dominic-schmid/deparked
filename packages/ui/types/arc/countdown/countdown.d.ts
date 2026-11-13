import { type ReactNode, type Ref } from "react";
export type CountdownUnit = "days" | "hours" | "minutes" | "seconds";
/** Use a countdown for a fixed moment people wait for: a launch, a live event, or a deadline. */
export interface CountdownProps {
    /**
     * The moment to count down to. A number is epoch milliseconds, a Date is used as is, and an ISO string with `Z` or an offset
     * such as `2026-10-06T10:00:00-07:00` is exact. A string without an offset is wall time in `timeZone`, or UTC when no zone is given,
     * so the result never depends on the visitor's own time zone.
     */
    target: Date | number | string;
    /** IANA zone for a target string without an offset, such as "America/Los_Angeles". Daylight saving is resolved for the target date. */
    timeZone?: string;
    /** Units to show, largest first. The largest unit absorbs the rest, so hours can pass 24 when days are left out. */
    units?: CountdownUnit[];
    /** Large digits with unit labels, or one compact line for banners and table cells. */
    variant?: "large" | "compact";
    /** Shown once the target passes. The digits morph into it. */
    completeLabel?: ReactNode;
    /** Fires once, the moment the countdown reaches zero while mounted. It fires on time even when the tab is hidden. */
    onComplete?: () => void;
    /** Accessible name, such as "Keynote starts in". */
    label?: string;
    /** Clock source in epoch milliseconds. Pass a server-synced clock when the visitor's device time cannot be trusted. */
    clock?: () => number;
    ref?: Ref<HTMLDivElement>;
    className?: string;
}
/** Resolves a countdown target to epoch milliseconds without ever reading the device's own time zone. */
export declare function toEpoch(target: Date | number | string, timeZone?: string): number;
export declare function Countdown({ target, timeZone, units, variant, completeLabel, onComplete, label, clock, ref, className }: CountdownProps): import("react").JSX.Element;
export default Countdown;
