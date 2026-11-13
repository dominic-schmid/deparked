export interface ToastProps {
    title: string;
    description?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    duration?: number;
}
export default function Toast({ title, description, open, onOpenChange, duration }: ToastProps): import("react").JSX.Element;
