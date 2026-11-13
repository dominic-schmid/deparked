import type { ReactNode } from "react";
export type ToastType = "success" | "info" | "warning" | "error" | "loading";
export interface ToastAction {
    label: string;
    /** Runs the action. The toast closes afterwards unless the handler updates it, so an Undo can morph the toast into its result. */
    onClick: (id: string) => void;
}
export interface ToastOptions {
    /** Reuse an id to update a toast in place instead of stacking a new one. */
    id?: string;
    type?: ToastType;
    title: string;
    description?: string;
    action?: ToastAction;
    /** Milliseconds before the toast closes itself. Defaults by type; loading toasts wait for an update. Pass Infinity to keep it until closed. */
    duration?: number;
}
export interface ToastStackApi {
    /** Shows a toast and returns its id. */
    toast: (options: ToastOptions) => string;
    /** Morphs a toast in place: icon, copy, and height animate to the new content and its timer restarts. Pass `action: undefined` to remove the action. */
    update: (id: string, patch: Partial<Omit<ToastOptions, "id">>) => void;
    /** Dismisses one toast, or every toast when called without an id. */
    dismiss: (id?: string) => void;
}
export interface ToastStackProviderProps {
    children: ReactNode;
    /** Base lifetime in milliseconds. Warnings and errors stay 1.6 times longer. */
    duration?: number;
    /** Oldest toasts beyond this count are dropped from the queue. */
    limit?: number;
}
/**
 * The viewport for a toast stack. Render it once inside a `ToastStackProvider` and call `useToastStack()` anywhere below.
 * Use it for short, non-blocking results of what someone just did: new toasts rise from the bottom edge, older ones tuck behind,
 * and hovering or focusing the stack fans it out into a list. Toasts pause while the stack is open or the tab is hidden, and swipe right to dismiss.
 */
export interface ToastStackProps {
    /** Accessible name of the notification region. */
    label?: string;
    position?: "bottom-right" | "bottom-center" | "bottom-left";
    /** Pins the stack inside the nearest positioned ancestor instead of the window, for panels and previews. */
    contained?: boolean;
    /** How many toasts show at once. Older ones wait behind and return as the front ones close. */
    visibleToasts?: number;
    /** Alt+T moves focus into the stack. */
    hotkey?: boolean;
    className?: string;
}
/** Scopes a toast queue to its subtree, so two stacks on one page never share toasts. */
export declare function ToastStackProvider({ children, duration, limit }: ToastStackProviderProps): import("react").JSX.Element;
/** Shows, updates, and dismisses toasts from anywhere inside the provider. `count` is how many toasts are queued. */
export declare function useToastStack(): ToastStackApi & {
    count: number;
};
export declare function ToastStack({ label, position, contained, visibleToasts, hotkey, className }: ToastStackProps): import("react").JSX.Element;
export default ToastStack;
