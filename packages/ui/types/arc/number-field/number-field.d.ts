/** Text shown beside the number. A function receives the value, so a unit can follow it: `n => n === 1 ? " seat" : " seats"`. */
export type NumberFieldAffix = string | ((value: number) => string);
export interface NumberFieldProps {
    label: string;
    value?: number;
    defaultValue?: number;
    onValueChange?: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    /** PageUp, PageDown, and Shift with an arrow move this far. Defaults to ten steps. */
    largeStep?: number;
    description?: string;
    disabled?: boolean;
    id?: string;
    /** Text before the number, such as "$". */
    prefix?: NumberFieldAffix;
    /** Text after the number, such as " seats". */
    suffix?: NumberFieldAffix;
    /** Drag the label sideways to scrub the value, one step every few pixels. */
    scrub?: boolean;
    /** Formatting locale. Fixed by default so server and client render the same digits. */
    locale?: string;
    /** Fraction digits and grouping. Fraction digits follow the precision of `step` by default. */
    formatOptions?: {
        minimumFractionDigits?: number;
        maximumFractionDigits?: number;
        useGrouping?: boolean;
    };
    /** Control height, type size, and default width. */
    size?: NumberFieldSize;
    /** A short note beside the label when a press meets a limit or a typed value passes one. `false` hides it; a function writes the copy. */
    limitHint?: boolean | ((edge: "min" | "max", limit: number) => string);
}
export type NumberFieldSize = "sm" | "md" | "lg";
/**
 * A bounded number with odometer digits. Buttons and arrow keys repeat and speed up while held, PageUp and PageDown take
 * large steps, Home and End jump to the limits, and `scrub` lets the label be dragged. Typing edits a plain draft that
 * applies live while valid; the rolling digits return once it commits on Enter, blur, or the next step.
 */
export declare function NumberField({ label, value, defaultValue, onValueChange, min, max, step: stepProp, largeStep, description, disabled, id, prefix, suffix, scrub, locale, formatOptions, size, limitHint }: NumberFieldProps): import("react").JSX.Element;
