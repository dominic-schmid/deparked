import { type ReactNode } from "react";
export interface Segment {
    value: string;
    label: string; /** Optional content after the label, such as a badge. */
    accessory?: ReactNode;
}
export interface SegmentedControlProps {
    options: Segment[];
    value: string;
    onValueChange: (value: string) => void;
    label?: string;
    /** Called when the pointer or focus reaches an option, before it is chosen. Use it to start loading what that option shows. */
    onOptionIntent?: (value: string) => void;
    /** Stretch to the container's width and share it equally between the segments, like an iOS segmented control on a phone. */
    fullWidth?: boolean;
    className?: string;
}
export default function SegmentedControl({ options, value, onValueChange, label, onOptionIntent, fullWidth, className }: SegmentedControlProps): import("react").JSX.Element;
