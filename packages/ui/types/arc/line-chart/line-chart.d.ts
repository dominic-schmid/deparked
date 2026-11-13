import { type Ref } from "react";
export interface LineChartSeries {
    /** Stable identity. A series keeps its line across data changes, so switching ranges morphs the path instead of redrawing it. */
    key: string;
    /** Name in the legend, the tooltip, and the data table. */
    label: string;
    /** Any CSS color. Defaults to the accent for the first series, then quieter neutral steps. */
    color?: string;
    /** Draws a dashed stroke, useful for a previous period or a target. */
    dashed?: boolean;
    /** Fills the area under the line with a faint tint of its color. Defaults to true for the first series. */
    area?: boolean;
}
export interface LineChartDatum {
    /** Stable identity, such as an ISO date. */
    key: string;
    /** Full label for the tooltip and screen readers, such as "Tue, Sep 15". */
    label: string;
    /** Short label on the x axis, such as "Sep 15". Leave it out to keep the axis quiet at that point. */
    axisLabel?: string;
    /** One value per series key. A missing value counts as zero. */
    values: Record<string, number | undefined>;
}
/** Use a line chart for one or more measures over time, when the shape of the trend matters more than any single value. */
export interface LineChartProps {
    data: LineChartDatum[];
    series: LineChartSeries[];
    /** What is measured, such as "Signups". Names the chart for assistive technology. */
    label: string;
    /** Unit after each value in the tooltip, such as "ms". */
    unit?: string;
    /** Plot height in pixels. The width follows the container. */
    height?: number;
    /** Formats values in the tooltip and data table. */
    formatValue?: (value: number, series: LineChartSeries) => string;
    /** Formats the value axis. Defaults to a compact number, such as 1.2K. */
    formatTick?: (value: number) => string;
    /** Controlled hidden series keys. */
    hiddenSeries?: string[];
    defaultHiddenSeries?: string[];
    onHiddenSeriesChange?: (hidden: string[]) => void;
    /** Called as the crosshair moves, and with null when it leaves. Use it to drive a headline readout. */
    onActiveChange?: (index: number | null, datum: LineChartDatum | null) => void;
    /** Keeps the current lines on screen, dimmed, while the next range loads. */
    loading?: boolean;
    /** Shown when there are no points. */
    emptyLabel?: string;
    /** Series toggles above the plot. Shown by default when there is more than one series. */
    legend?: boolean;
    /** Header of the first column in the data table read by screen readers. */
    categoryLabel?: string;
    /** Smooth monotone curves that never swing past the data, or straight segments. */
    curve?: "smooth" | "linear";
    ref?: Ref<HTMLElement>;
    className?: string;
}
export declare function LineChart({ data, series, label, unit, height, formatValue, formatTick, hiddenSeries, defaultHiddenSeries, onHiddenSeriesChange, onActiveChange, loading, emptyLabel, legend, categoryLabel, curve, ref, className }: LineChartProps): import("react").JSX.Element;
export default LineChart;
