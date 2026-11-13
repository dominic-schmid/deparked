export type ColorFormat = "hex" | "rgb" | "hsl" | "oklch";
export interface ColorSwatch {
    id: string;
    color: string;
}
/**
 * A color field whose swatch grows into a full picker. Pick saturation and brightness on the area, hue and opacity on the sliders, or type a value
 * in hex, RGB, HSL, or OKLCH; the format button morphs the text between them. The eyedropper appears where the browser supports it, saved
 * swatches can be added, applied, dragged or moved with Alt and the arrow keys, and removed with Delete. A contrast readout compares the color with
 * the background it will sit on. Arrow keys move every thumb, Shift takes bigger steps, and Escape closes the panel.
 */
export interface ColorPickerProps {
    /** Any color the picker can read: hex, rgb(), hsl(), or oklch(). */
    value?: string;
    defaultValue?: string;
    /** Receives the color as hex, with two alpha digits when it is not opaque. */
    onValueChange?: (hex: string) => void;
    /** The background the color will sit on, for the contrast readout. */
    background?: string;
    /** Name shown on the swatch, such as "Accent". */
    label?: string;
    swatches?: ColorSwatch[];
    defaultSwatches?: ColorSwatch[];
    onSwatchesChange?: (swatches: ColorSwatch[]) => void;
    /** Most saved swatches. Saving past it drops the oldest. */
    maxSwatches?: number;
    defaultFormat?: ColorFormat;
    className?: string;
}
export type Hsva = {
    h: number;
    s: number;
    v: number;
    a: number;
};
export declare function toHex(hsva: Hsva): string;
/** Reads hex, rgb(), hsl(), and oklch() in modern or comma syntax. Returns null for anything else. */
export declare function parseColor(input: string, hue?: number): Hsva | null;
export declare function ColorPicker({ value, defaultValue, onValueChange, background, label, swatches: swatchesProp, defaultSwatches, onSwatchesChange, maxSwatches, defaultFormat, className, }: ColorPickerProps): import("react").JSX.Element;
export default ColorPicker;
