export type ThemeSwitchVariant = "reveal" | "eclipse" | "split" | "rise";
export type Theme = "light" | "dark";
export interface ThemeSwitchProps {
    theme: Theme;
    variant?: ThemeSwitchVariant;
    onThemeChange: (next: Theme, variant: ThemeSwitchVariant, trigger: HTMLElement) => void;
    label?: string;
    iconOnly?: boolean;
}
export declare function ThemeSwitch({ theme, variant, onThemeChange, label, iconOnly }: ThemeSwitchProps): import("react").JSX.Element;
export default ThemeSwitch;
