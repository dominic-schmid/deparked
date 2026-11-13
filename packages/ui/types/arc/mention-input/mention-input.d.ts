export type MentionKind = "person" | "channel";
export interface MentionPerson {
    id: string;
    name: string;
    /** One short line under the name, such as a job title. */
    role?: string;
    /** Portrait URL. Initials show when it is missing. */
    avatar?: string;
}
export interface MentionChannel {
    id: string;
    name: string;
    description?: string;
    members?: number;
}
/** A mention inside `text`. `start` and `end` are character offsets; the text between them is `@label` or `#label`. */
export interface Mention {
    kind: MentionKind;
    id: string;
    label: string;
    start: number;
    end: number;
}
export interface MentionValue {
    text: string;
    mentions: Mention[];
}
export interface MentionInputHandle {
    focus: () => void;
    /** Inserts text at the caret, as if typed. */
    insert: (text: string) => void;
    /** Types a trigger at the caret so the suggestions open, adding a space first when needed. */
    openSuggestions: (kind: MentionKind) => void;
    clear: () => void;
    textarea: HTMLTextAreaElement | null;
}
export interface MentionInputProps {
    value?: MentionValue;
    defaultValue?: MentionValue;
    onChange?: (value: MentionValue) => void;
    /** People offered after `@`. Leave it out to turn person mentions off. */
    people?: MentionPerson[];
    /** Channels offered after `#`. Leave it out to turn channel mentions off. */
    channels?: MentionChannel[];
    /** Called when a suggestion becomes a mention. */
    onMentionAdd?: (mention: Mention) => void;
    /** With `submitOnEnter`, Enter submits and Shift+Enter adds a line. */
    onSubmit?: (value: MentionValue) => void;
    submitOnEnter?: boolean;
    placeholder?: string;
    minRows?: number;
    /** The field grows to this many rows, then scrolls. */
    maxRows?: number;
    /** Where suggestions open. `auto` flips above when there is no room below. */
    placement?: "auto" | "top" | "bottom";
    maxSuggestions?: number;
    disabled?: boolean;
    name?: string;
    id?: string;
    "aria-label"?: string;
    "aria-describedby"?: string;
    className?: string;
}
export declare const mentionText: (kind: MentionKind, label: string) => string;
/** Turns a value into storage friendly text, `<@id>` for people and `<#id>` for channels by default. */
export declare function serializeMentions(value: MentionValue, format?: (mention: Mention) => string): string;
/**
 * A textarea with `@` people and `#` channel mentions. Mentions are atomic: the caret steps over them and one Backspace removes the whole token.
 * The value carries plain text plus a structured `mentions` array with offsets, ready to store or notify.
 */
export declare const MentionInput: import("react").ForwardRefExoticComponent<MentionInputProps & import("react").RefAttributes<MentionInputHandle>>;
export default MentionInput;
