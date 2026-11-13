export type CopyFeedbackState = "idle" | "copied" | "error";
/**
 * Writes text to the clipboard. Uses the async Clipboard API and falls back to a hidden textarea with
 * document.execCommand("copy") when the API is missing or refused (sandboxed or cross-origin iframes, Safari
 * inside embedded previews, insecure contexts). Must be called from a user gesture. Rejects only when both fail.
 */
export declare function writeClipboard(text: string): Promise<void>;
/** Shared clipboard state for actions that render their own button or menu. */
export declare function useCopyFeedback(duration?: number): {
    state: CopyFeedbackState;
    activeKey: string | null;
    copy: (value: string, key?: string) => Promise<boolean>;
    reset: () => void;
};
