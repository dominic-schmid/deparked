export interface BarChartDatum {
    /** Stable identity, such as an ISO date. A bar whose key survives a data change keeps its place, so switching ranges morphs instead of redrawing. */
    key: string;
    /** Full label for the headline and screen readers, such as "Tue, Sep 15". */
    label: string;
    /** Short label under the bar, such as "T" or "Sep 14". Leave it out to keep the axis quiet. */
    axisLabel?: string;
    value: number;
}
/** Use a bar chart for one measure across a run of days, weeks, or months, when people compare each period against the rest and against the average. */
export interface BarChartProps {
    data: BarChartDatum[];
    /** What is measured, such as "Active minutes". Names the chart for assistive technology. */
    label: string;
    /** The range on show, such as "Sep 15–21, 2026". It rests under the headline. */
    period: string;
    /** Unit after each value, such as "min". */
    unit?: string;
    /** Headline label at rest, above the average. */
    averageLabel?: string;
    /** Headline label while a bar is scrubbed. */
    valueLabel?: string;
    /** Header of the first column in the data table read by screen readers. */
    categoryLabel?: string;
    /** Draws the average as a reference line that springs to each new range. */
    showAverage?: boolean;
    /** Plot height in pixels. */
    height?: number;
    formatValue?: (value: number) => string;
}
export declare function BarChart({ data, label, period, unit, averageLabel, valueLabel, categoryLabel, showAverage, height, formatValue }: BarChartProps): import("react").JSX.Element;
export default BarChart;
