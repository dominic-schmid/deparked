/** One font face as the page sets it: what a line of it measures, without a browser. */
export type Face = {
  /** Advance widths of U+0020..U+007E, in thousandths of an em. */
  advances: readonly number[];
  /** Kerning between pairs of hostname characters (a-z, 0-9, dot, hyphen), same units. */
  kerning: Readonly<Record<string, number>>;
  /** The CSS `letter-spacing` the wordmark is set with, same units. */
  letterSpacing: number;
};

export type FitOptions = {
  /** The share of the container's width a line may span, in cqi. */
  spanCqi: number;
  /** Below this size one line stops reading as a wordmark, so a longer headline is set on several lines. */
  minOneLineCqi: number;
  /** A short name would otherwise grow taller than the phone it is on. */
  maxCqi: number;
};

/** `lines` are the headline cut into rows (a trailing space stays with its row), never wrapped by the browser; `null` leaves an unmeasurable headline to wrap itself. */
export type WordmarkFit = { fontSizeCqi: number; lines: string[] | null };

/**
 * Sizes a wordmark so the headline spans its container at every width: on one line when that stays readable,
 * otherwise on the fewest even lines, broken after a hyphen, before a dot or at a space where one is near.
 */
export function fitWordmark(headline: string, face: Face, { spanCqi, minOneLineCqi, maxCqi }: FitOptions): WordmarkFit {
  const glyphs = [...headline];
  if (!glyphs.every((glyph) => glyph.length === 1 && face.advances[glyph.charCodeAt(0) - 32] !== undefined)) {
    // Glyphs from a fallback font: assume they are wide, and let the browser break the lines.
    const em = glyphs.length * 0.7;
    const lines = Math.max(1, Math.ceil((em * minOneLineCqi) / spanCqi));
    return { fontSizeCqi: round(Math.min((spanCqi * lines * 0.85) / em, maxCqi)), lines: null };
  }
  const width = (text: string) => widthOf(text, face);
  const total = width(headline);
  const count = Math.max(1, Math.ceil((total * minOneLineCqi) / spanCqi));
  const lines =
    count === 1
      ? [headline]
      : (balance(headline, count, true, width) ?? balance(headline, count, false, width) ?? [headline]);
  const widest = Math.max(...lines.map((line) => width(line.trim())), 0.1);
  return { fontSizeCqi: round(Math.min(spanCqi / widest, maxCqi)), lines };
}

/** The set width of a run of measurable text, in em. */
function widthOf(text: string, { advances, kerning, letterSpacing }: Face): number {
  let units = 0;
  for (let index = 0; index < text.length; index++) {
    units += (advances[text.charCodeAt(index) - 32] ?? 0) + (kerning[text.slice(index, index + 2)] ?? 0) + letterSpacing;
  }
  return units / 1000;
}

/**
 * Splits text into `count` lines with the narrowest possible widest line. With `natural`, only at the places a
 * reader expects; it gives up (`undefined`) when those leave one line much wider than an even split would.
 */
function balance(
  text: string,
  count: number,
  natural: boolean,
  width: (text: string) => number,
): string[] | undefined {
  const breaks = [];
  for (let index = 1; index < text.length; index++) {
    const before = text[index - 1];
    if (!natural || before === "-" || before === " " || text[index] === ".") breaks.push(index);
  }
  // best[k][j]: the narrowest widest line when the text up to breaks[j] is set on k + 1 lines
  const ends = [...breaks, text.length];
  const line = (from: number, to: number) => width(text.slice(from, to).trim());
  let best = ends.map((end) => ({ widest: line(0, end), cuts: [] as number[] }));
  for (let k = 1; k < count; k++) {
    best = ends.map((end, j) => {
      let choice = { widest: Number.POSITIVE_INFINITY, cuts: [] as number[] };
      for (let i = 0; i < j; i++) {
        const previous = best[i];
        const cut = ends[i];
        if (!previous || cut === undefined) continue;
        const widest = Math.max(previous.widest, line(cut, end));
        if (widest < choice.widest) choice = { widest, cuts: [...previous.cuts, cut] };
      }
      return choice;
    });
  }
  const result = best.at(-1);
  if (!result || !Number.isFinite(result.widest)) return undefined;
  if (natural && result.widest > (width(text) / count) * 1.3) return undefined;
  return [0, ...result.cuts].map((from, index) => text.slice(from, result.cuts[index] ?? text.length));
}

const round = (value: number) => Math.floor(value * 100) / 100;
