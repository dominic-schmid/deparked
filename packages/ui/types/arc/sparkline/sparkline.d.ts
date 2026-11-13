export interface SparklineProps {
    data: number[];
    label: string;
    value?: string;
    change?: string;
    tone?: "accent" | "success" | "warning" | "danger";
    width?: number;
    height?: number;
    /** One label per point, such as a date. It replaces the change while that point is scrubbed. */
    labels?: string[];
    /** Formats a scrubbed point for the headline. Defaults to a grouped number. */
    formatValue?: (value: number, index: number) => string;
    /** A quiet neutral fill under the line. */
    area?: boolean;
    /** Pointer and keyboard scrubbing through the points. */
    interactive?: boolean;
}
export declare function Sparkline({ data, label, value, change, tone, width, height, labels, formatValue, area, interactive }: SparklineProps): import("react").JSX.Element;
export default Sparkline;
