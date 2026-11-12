// Advance widths of U+0020..U+007E in the catalog's Archivo at width 62, weight 800, in thousandths of an em.
// Measured once from the subset file with canvas `measureText`; re-measure if `archivo-condensed` changes.
const ADVANCES = [
  117, 258, 364, 480, 377, 704, 534, 199, 365, 365, 369, 509, 212, 240, 212, 271, 427, 361, 417, 424, 414, 426, 427,
  380, 415, 427, 221, 221, 509, 509, 509, 409, 679, 500, 482, 505, 503, 452, 395, 532, 504, 243, 426, 501, 411, 677,
  508, 543, 472, 543, 498, 454, 458, 495, 473, 703, 487, 480, 463, 353, 271, 353, 509, 360, 177, 426, 423, 403, 423,
  414, 264, 398, 418, 212, 213, 428, 212, 627, 419, 418, 423, 423, 274, 377, 264, 419, 381, 594, 415, 376, 368, 366,
  197, 366, 509,
];
// Kerning between the characters of a hostname (a-z, 0-9, dot, hyphen), same units, same measurement.
const KERNING: Record<string, number> = {
  "77": -10,
  bv: -3,
  bw: -3,
  bx: -25,
  by: -5,
  bz: -18,
  ex: -5,
  ff: -19,
  fl: -1,
  f7: 10,
  "f.": -35,
  "f-": -10,
  ka: -25,
  kc: -25,
  kd: -25,
  ke: -25,
  ko: -25,
  kq: -25,
  ks: -15,
  kv: -20,
  kw: -20,
  kx: -25,
  ky: -20,
  kz: -15,
  "k-": -35,
  ov: -3,
  ow: -3,
  ox: -25,
  oy: -5,
  oz: -18,
  pv: -3,
  pw: -3,
  px: -25,
  py: -5,
  pz: -18,
  ra: -5,
  rc: -5,
  rd: -5,
  re: -5,
  ro: -5,
  rq: -5,
  "r.": -55,
  sv: -3,
  sw: -3,
  sx: -21,
  sy: -14,
  sz: -8,
  va: -15,
  vc: -3,
  vd: -3,
  ve: -3,
  vo: -3,
  vq: -3,
  "v.": -50,
  wa: -15,
  wc: -3,
  wd: -3,
  we: -3,
  wo: -3,
  wq: -3,
  "w.": -50,
  xa: -25,
  xc: -25,
  xd: -25,
  xe: -25,
  xo: -25,
  xq: -25,
  "x-": -20,
  ya: -15,
  yc: -3,
  yd: -3,
  ye: -3,
  yo: -3,
  yq: -3,
  "y.": -50,
  za: -18,
  zc: -18,
  zd: -18,
  ze: -18,
  zo: -18,
  zq: -18,
  "0-": 40,
  "1-": 40,
  "2-": 10,
  "3-": 40,
  "4-": 40,
  "5-": 40,
  "6-": 20,
  "7.": -80,
  "7-": -40,
  "8-": 30,
  "9-": 40,
  "-x": -20,
  "-0": 40,
  "-1": 40,
  "-2": 40,
  "-3": 40,
  "-4": 40,
  "-5": 40,
  "-6": 40,
  "-8": 30,
  "-9": 20,
};
const LETTER_SPACING = -20;
// The share of the body's width a line may span. wrappr.app's ten glyphs are 3.638em and were set at 27cqi.
const SPAN_CQI = 27 * 3.638;
// Below this size one line stops reading as a wordmark, so a longer headline is set on several lines.
const MIN_ONE_LINE_CQI = 10.5;
// A short name would otherwise grow taller than the phone it is on.
const MAX_CQI = 42;

/** `lines` are the headline cut into rows (a trailing space stays with its row), never wrapped by the browser; `null` leaves an unmeasurable headline to wrap itself. */
export type MarkFit = { fontSizeCqi: number; lines: string[] | null };

/**
 * Sizes the wordmark so the headline spans the page at every width: on one line when that stays readable,
 * otherwise on the fewest even lines, broken after a hyphen, before a dot or at a space where one is near.
 */
export function fitMark(headline: string): MarkFit {
  const glyphs = [...headline];
  if (!glyphs.every((glyph) => glyph.length === 1 && ADVANCES[glyph.charCodeAt(0) - 32] !== undefined)) {
    // Glyphs from a fallback font: assume they are wide, and let the browser break the lines.
    const em = glyphs.length * 0.7;
    const lines = Math.max(1, Math.ceil((em * MIN_ONE_LINE_CQI) / SPAN_CQI));
    return { fontSizeCqi: round(Math.min((SPAN_CQI * lines * 0.85) / em, MAX_CQI)), lines: null };
  }
  const total = width(headline);
  const count = Math.max(1, Math.ceil((total * MIN_ONE_LINE_CQI) / SPAN_CQI));
  const lines =
    count === 1 ? [headline] : (balance(headline, count, true) ?? balance(headline, count, false) ?? [headline]);
  const widest = Math.max(...lines.map((line) => width(line.trim())), 0.1);
  return { fontSizeCqi: round(Math.min(SPAN_CQI / widest, MAX_CQI)), lines };
}

/** The set width of a run of measurable text, in em. */
function width(text: string): number {
  let units = 0;
  for (let index = 0; index < text.length; index++) {
    units +=
      (ADVANCES[text.charCodeAt(index) - 32] ?? 0) + (KERNING[text.slice(index, index + 2)] ?? 0) + LETTER_SPACING;
  }
  return units / 1000;
}

/**
 * Splits text into `count` lines with the narrowest possible widest line. With `natural`, only at the places a
 * reader expects; it gives up (`undefined`) when those leave one line much wider than an even split would.
 */
function balance(text: string, count: number, natural: boolean): string[] | undefined {
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
