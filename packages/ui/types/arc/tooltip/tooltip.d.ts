import type { ReactElement, ReactNode } from "react";
export interface TooltipProps {
    content: ReactNode;
    children: ReactElement;
    side?: "top" | "bottom" | "left" | "right";
}
export declare function Tooltip({ content, children, side }: TooltipProps): import("react").JSX.Element;
export default Tooltip;
