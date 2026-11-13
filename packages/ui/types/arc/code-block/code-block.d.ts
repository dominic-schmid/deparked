export interface CodeBlockProps {
    /** Source shown in the block and copied by the action. */
    code: string;
    /** File name displayed in the header. */
    filename?: string;
    /** Used for the header label and lightweight syntax highlighting. */
    language?: string;
    /** Collapse longer sources to this many lines, with a toggle that expands the rest in place. */
    maxLines?: number;
}
export declare function CodeBlock({ code, filename, language, maxLines }: CodeBlockProps): import("react").JSX.Element;
