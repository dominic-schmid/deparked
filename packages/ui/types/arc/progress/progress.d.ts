export interface ProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
    value?: number;
    max?: number;
    label?: string;
    showValue?: boolean;
}
export declare function Progress({ value, max, label, showValue, className, ...props }: ProgressProps): import("react").JSX.Element;
export default Progress;
