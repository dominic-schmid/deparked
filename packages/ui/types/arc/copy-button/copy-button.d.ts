import { type CopyFeedbackState } from "../lib/use-copy-feedback";
export interface CopyButtonProps {
    value: string;
    label?: string;
    className?: string;
    iconOnly?: boolean;
    variant?: "outline" | "plain";
    disabled?: boolean;
    onCopied?: () => void;
}
/**
 * The glyph a copy control shows: the copy icon at rest; on success it fades and a tick is drawn in its place, on
 * failure a short alert mark. `pulse` redraws the tick when the same value is copied twice. Shared with the site's copy controls.
 */
export declare function CopyGlyph({ state, pulse, size, reduced }: {
    state: CopyFeedbackState;
    pulse?: number;
    size?: number;
    reduced?: boolean;
}): import("react").JSX.Element;
export declare function CopyButton({ value, label, className, iconOnly, variant, disabled, onCopied }: CopyButtonProps): import("react").JSX.Element;
