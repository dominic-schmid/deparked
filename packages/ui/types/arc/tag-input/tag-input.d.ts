export interface TagInputProps {
    label: string;
    value?: string[];
    defaultValue?: string[];
    onValueChange?: (value: string[]) => void;
    placeholder?: string;
    description?: string;
    id?: string;
}
/**
 * Tags keep the field still: a new tag blurs in where its text was typed while the caret glides aside, a removed tag
 * leaves its slot and the rest glide in, and the shell follows wrapped rows on a spring. Backspace or the arrow keys
 * pick a tag first, a ring glides to it, and the next Backspace removes it.
 */
export declare function TagInput({ label, value, defaultValue, onValueChange, placeholder, description, id }: TagInputProps): import("react").JSX.Element;
