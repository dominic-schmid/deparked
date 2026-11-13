export interface UsageMeterSegment {
    /** Stable identity. Keep it the same while the value changes, so the segment re-flows instead of being replaced. */
    id: string;
    label: string;
    value: number;
}
/** Use a usage meter for a fixed allowance, such as storage or seats, when people need to see what takes the space and how close they are to the limit. */
export interface UsageMeterProps {
    /** What is measured, such as "Workspace storage". */
    label: string;
    /** Used amounts in display order. Up to four read clearly. */
    segments: UsageMeterSegment[];
    /** The plan limit, in the same unit as the segments. */
    limit: number;
    unit?: string;
    /** Digits after the decimal point. */
    decimals?: number;
    freeLabel?: string;
    overLabel?: string;
    /** Share of the limit at which the meter warns that it is almost full. */
    warnAt?: number;
}
export declare function UsageMeter({ label, segments, limit, unit, decimals, freeLabel, overLabel, warnAt }: UsageMeterProps): import("react").JSX.Element;
export default UsageMeter;
