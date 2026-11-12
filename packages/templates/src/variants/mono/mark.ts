import { fitWordmark, type WordmarkFit } from "../shared/wordmark/fit";

// JetBrains Mono is monospaced: every glyph from U+0020 to U+007E advances 600 thousandths of an em, at every
// weight, with no kerning. Measured once from the catalog's subset in Chromium; re-measure if `jetbrains-mono` changes.
const FACE = { advances: Array.from({ length: 95 }, () => 600), kerning: {}, letterSpacing: -40 };
const OPTIONS = {
  spanCqi: 99,
  // a line of a long name stays at least this large; below it, the name is set on more lines
  minOneLineCqi: 8.5,
  maxCqi: 30,
};

/**
 * Sizes Mono's wordmark so the headline and the caret after it span the page. The caret is one glyph wide, so the
 * headline is fitted with one more character, which is then dropped from the last line again.
 */
export function fitMark(headline: string): WordmarkFit {
  const fit = fitWordmark(`${headline}_`, FACE, OPTIONS);
  if (!fit.lines) return fit;
  const lines = [...fit.lines];
  lines[lines.length - 1] = (lines.at(-1) ?? "").slice(0, -1);
  return { ...fit, lines: lines.filter((line, index) => line !== "" || index === 0) };
}
