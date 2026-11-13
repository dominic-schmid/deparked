import type { ReactNode, Ref } from "react";
export type UserStatus = "available" | "busy" | "away";
export type ThemePreference = "light" | "dark" | "system";
/** Statuses in menu order. Each one has its own dot shape as well as color: solid, barred, or hollow. */
export declare const userStatuses: {
    value: UserStatus;
    label: string;
}[];
export interface UserMenuUser {
    name: string;
    email: string;
    plan?: string;
    avatarSrc?: string;
    avatarSrcSet?: string;
}
export interface UserMenuItem {
    label: string;
    icon?: ReactNode;
    keys?: string[];
    onSelect?: () => void;
}
/**
 * The account menu behind a person's photo in an app's top bar. It holds a compact identity header, a short group of account
 * destinations, an inline theme switch, and sign out. On screens narrower than 640px it opens as a bottom sheet instead.
 * Theme and status choices keep the menu open; everything else closes it and returns focus to the trigger.
 * When `onSignOut` returns a promise, the item shows its progress and the menu closes once it settles.
 */
export interface UserMenuProps {
    user: UserMenuUser;
    /** Presence status. Passing `status` or `onStatusChange` shows the presence dot and an inline status switch. */
    status?: UserStatus;
    defaultStatus?: UserStatus;
    onStatusChange?: (status: UserStatus) => void;
    theme?: ThemePreference;
    defaultTheme?: ThemePreference;
    /** Reports the choice. Applying it to the page is up to the app. */
    onThemeChange?: (theme: ThemePreference) => void;
    /** Shows the inline light, dark, and system switch. */
    showTheme?: boolean;
    /** Account destinations with optional shortcut hints, such as ["⌘", ","]. Keep it to three or four. */
    items?: UserMenuItem[];
    onSignOut?: () => void | Promise<unknown>;
    signOutKeys?: string[];
    align?: "start" | "center" | "end";
    /** Shows the name and a chevron beside the avatar from 640px up. */
    showName?: boolean;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Renders the desktop panel in a portal on the body. Pass false to keep it inside the trigger's wrapper. */
    portal?: boolean;
    /** The trigger button, for returning focus after the menu is swapped out. */
    ref?: Ref<HTMLButtonElement>;
    className?: string;
}
/** A presence mark that morphs between statuses: the color crossfades while a hole opens for away and a bar slides in for busy. */
export declare function PresenceDot({ status, className }: {
    status: UserStatus | "offline";
    className?: string;
}): import("react").JSX.Element;
export declare function UserMenu({ user, status: statusProp, defaultStatus, onStatusChange, theme: themeProp, defaultTheme, onThemeChange, showTheme, items, onSignOut, signOutKeys, align, showName, open: openProp, defaultOpen, onOpenChange, portal, ref, className }: UserMenuProps): import("react").JSX.Element;
export default UserMenu;
