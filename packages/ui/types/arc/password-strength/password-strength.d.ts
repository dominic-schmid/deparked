import type { InputHTMLAttributes } from "react";
export interface PasswordRule {
    id: string;
    label: string;
    test: (password: string) => boolean;
    /** Characters still missing. Shown as a rolling count beside the rule while it is unmet. */
    remaining?: (password: string) => number;
}
export interface PasswordStrengthResult {
    level: 0 | 1 | 2 | 3 | 4;
    label: string;
    met: string[];
    /** True while the password is shorter than the short length, so the meter holds at its first step. */
    short?: boolean;
}
/** The strength words, one per meter step. Override them to translate the meter. */
export interface PasswordStrengthLevels {
    tooShort: string;
    weak: string;
    fair: string;
    good: string;
    strong: string;
}
/** Every user-facing string in PasswordStrength. All have English defaults; pass only the ones you change. */
export interface PasswordStrengthMessages {
    levels: PasswordStrengthLevels;
    /** Name of the show password toggle. It is a pressed toggle (aria-pressed), so the name stays the same in both states. */
    showPassword: string;
    /** Accessible name of the strength meter. */
    meterLabel: string;
    /** Meter value text while the field is empty. */
    noPassword: string;
    /** Accessible name of the requirements list. */
    rulesLabel: string;
    /** Read after a rule's label for screen readers, including any leading punctuation. */
    ruleMet: string;
    ruleNotMet: string;
    /** Words around the rolling count beside an unmet rule, as in "4 more". */
    remainingPrefix: string;
    remainingSuffix: string;
    /** The polite live-region summary read after each change. */
    summary: (result: {
        label: string;
        met: number;
        total: number;
    }) => string;
}
export declare const defaultPasswordStrengthMessages: PasswordStrengthMessages;
/** Partial messages, with partial strength words, for the `messages` prop. */
export type PasswordStrengthMessagesInput = Partial<Omit<PasswordStrengthMessages, "levels">> & {
    levels?: Partial<PasswordStrengthLevels>;
};
/**
 * A new password field that shows how strong the password is while it is typed: four segments fill and change tone,
 * each rule checks off with a drawn tick, and the strength word morphs in place. Use it when creating or changing a password;
 * use a plain password field for sign in. Scoring happens on the device, nothing is sent anywhere.
 */
export interface PasswordStrengthProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "children"> {
    label: string;
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string, strength: PasswordStrengthResult) => void;
    /** Rules to check. Strength is the share of rules met, spread over four steps. */
    rules?: PasswordRule[];
    /** Error copy tied to the field. The field shakes once each time a new error appears. */
    error?: string;
    revealed?: boolean;
    onRevealedChange?: (revealed: boolean) => void;
    /** Translated or reworded copy. Every string has an English default; see PasswordStrengthMessages. */
    messages?: PasswordStrengthMessagesInput;
    /** Below this many characters the meter holds at its first step and reads "Too short". Defaults to 8. */
    shortLength?: number;
    /** How characters are counted for shortLength. Defaults to code points, so an emoji counts once; pass `password => password.length` to count UTF-16 units like a server might. */
    countCharacters?: (password: string) => number;
}
/** Counts code points, so an emoji or other astral character counts as one. */
export declare const countCodePoints: (password: string) => number;
/** Labels for the built-in rules. `length` receives the minimum length. */
export interface PasswordRuleLabels {
    length: (minLength: number) => string;
    case: string;
    number: string;
    symbol: string;
}
export interface PasswordRuleOptions {
    /** Characters the length rule asks for. Defaults to 12. */
    minLength?: number;
    /** Translated or reworded rule labels. */
    labels?: Partial<PasswordRuleLabels>;
    /** How the length rule counts characters. Defaults to code points. */
    countCharacters?: (password: string) => number;
}
/** The built-in rules (length, mixed case, number, symbol) with your own minimum length, labels and character count. */
export declare function createPasswordRules({ minLength, labels, countCharacters }?: PasswordRuleOptions): PasswordRule[];
export declare const defaultPasswordRules: PasswordRule[];
export interface EstimateStrengthOptions {
    /** Below this many characters a password stays at the first step, however varied it is. Defaults to 8. */
    shortLength?: number;
    /** Strength words for the result's label. */
    levels?: Partial<PasswordStrengthLevels>;
    /** How characters are counted for shortLength. Defaults to code points. */
    countCharacters?: (password: string) => number;
}
/** Scores a password on the device: one step per share of rules met, capped at the first step while it is shorter than the short length (8 by default). */
export declare function estimateStrength(password: string, rules?: PasswordRule[], { shortLength, levels, countCharacters }?: EstimateStrengthOptions): PasswordStrengthResult;
export declare const PasswordStrength: import("react").ForwardRefExoticComponent<PasswordStrengthProps & import("react").RefAttributes<HTMLInputElement>>;
export default PasswordStrength;
