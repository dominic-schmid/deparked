export interface MetricCardProps {
    label: string;
    value: number;
    suffix?: string;
    context: string;
    change?: string;
}
export declare function MetricCard({ label, value, suffix, context, change }: MetricCardProps): import("react").JSX.Element;
