/**
 * WCAG 2 contrast for the owner's accent colour. The lander uses it to keep text on the accent, and the accent as
 * text or a mark on the page, readable whatever colour is picked; the admin's editor can apply the same rule.
 * Colours are six-digit hex (`#7f9fbf`), as the config schema stores them.
 */

/** Body text and the action button's label: WCAG AA for normal text. */
export const READABLE = 4.5;

const BLACK = "#000000";
const WHITE = "#ffffff";

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The colour for text set on `accent`: whichever of the design's own `ink` and `paper` reads better on it. When
 * neither reaches 4.5:1 (a mid-tone accent between an off-black and an off-white), black or white instead: one of
 * the two always does.
 */
export function contrastOn(accent: string, { ink, paper }: { ink: string; paper: string }): string {
  const best = contrastRatio(ink, accent) >= contrastRatio(paper, accent) ? ink : paper;
  if (contrastRatio(best, accent) >= READABLE) return best;
  return contrastRatio(BLACK, accent) >= contrastRatio(WHITE, accent) ? BLACK : WHITE;
}

/**
 * `color` as text or a mark on `background`: unchanged when it reads at `minimum`, otherwise the nearest shade of
 * it that does, mixed toward black on a light background or white on a dark one in steps of 5%.
 */
export function readableOn(color: string, background: string, minimum = READABLE): string {
  const target = contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? BLACK : WHITE;
  const from = channels(color);
  const to = channels(target);
  for (let step = 0; step <= 20; step++) {
    const mixed = `#${from
      .map((channel, index) => Math.round(channel + ((to[index] as number) - channel) * (step / 20)))
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")}`;
    if (contrastRatio(mixed, background) >= minimum) return mixed;
  }
  return target;
}
