import { type HTMLAttributes } from "react";
export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
    name: string;
    src?: string;
    size?: "sm" | "md" | "lg" | "xl";
    status?: "online" | "offline";
}
export declare function Avatar({ name, src, size, status, className, ...props }: AvatarProps): import("react").JSX.Element;
