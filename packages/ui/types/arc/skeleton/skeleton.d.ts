import { type ReactNode } from "react";
export interface SkeletonProps {
    label?: string;
    lines?: number;
    avatar?: boolean;
    className?: string;
    /** Content to reveal once loading finishes. With children, the placeholder crossfades into them. */
    children?: ReactNode;
    /** Keeps the placeholder visible while true. Only used together with children. */
    loading?: boolean;
}
export declare function Skeleton({ label, lines, avatar, className, children, loading }: SkeletonProps): import("react").JSX.Element;
export default Skeleton;
