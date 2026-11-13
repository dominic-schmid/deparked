/**
 * Morphs one short label into the next in place. Letters both strings share glide to their new positions, new letters sharpen in, removed letters blur away,
 * and the width follows on a spring so the surrounding layout glides instead of jumping. Use it for status words that change a few letters at a time,
 * such as Publish, Publishing, and Published, or Follow and Following. It stays on one line, and assistive technology reads the plain text.
 */
export interface TextMorphProps {
    children: string;
    as?: "span" | "div" | "p" | "strong" | "h1" | "h2" | "h3";
    className?: string;
    id?: string;
}
export declare function TextMorph({ children, as, className, id }: TextMorphProps): import("react").JSX.Element;
export default TextMorph;
