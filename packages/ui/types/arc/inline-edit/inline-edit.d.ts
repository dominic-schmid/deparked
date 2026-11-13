/**
 * Click-to-edit text for names and short fields that are read far more often than they change, such as a project name or its description.
 * The text turns into a field in place with the same metrics, so nothing around it moves, and the box grows with what you type. Enter saves
 * optimistically and a check draws once the save lands; Escape rolls the text back. A failed save restores the last saved value and says why.
 * Use a regular form when several fields must be saved together.
 */
export interface InlineEditProps {
    /** The saved value. A new value from outside replaces the text while it is not being edited. */
    value: string;
    /** Persists the new value. Return a promise to show the saving state, and reject it to roll back. */
    onSave: (next: string) => void | Promise<unknown>;
    /** Accessible name, for example “Project name”. */
    label: string;
    /** Returns a message when the draft cannot be saved. */
    validate?: (next: string) => string | null | undefined;
    /** Shown when the value is empty. */
    placeholder?: string;
    /** Wraps onto several lines and grows in height. Enter still saves; Shift+Enter adds a line break. */
    multiline?: boolean;
    /** `title` for names and headings, `body` for descriptions. */
    variant?: "title" | "body";
    /** The element that holds the text, so a title can stay a heading. */
    as?: "span" | "p" | "h1" | "h2" | "h3";
    className?: string;
}
export declare function InlineEdit({ value, onSave, label, validate, placeholder, multiline, variant, as: Tag, className }: InlineEditProps): import("react").JSX.Element;
export default InlineEdit;
