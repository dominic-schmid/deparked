export interface AnimatedCounterProps {
    value: number;
    label?: string;
    prefix?: string;
    suffix?: string;
    decimals?: number;
    /** Roll every digit up from zero the first time the counter scrolls into view. */
    animateOnView?: boolean;
    /** Formatting locale. Fixed by default so server and client render the same digits. */
    locale?: string;
}
export declare function AnimatedCounter({ value, label, prefix, suffix, decimals, animateOnView, locale }: AnimatedCounterProps): import("react").JSX.Element;
export default AnimatedCounter;
