import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { variants } from "./index";

describe("each variant's entrance", () => {
  // A browser does not time the largest paint of an element that starts invisible from its first frame, and a
  // near-invisible start only hides that: the content is on screen from the first frame instead.
  it.each(Object.keys(variants))("%s never starts the content invisible", (id) => {
    const css = readFileSync(new URL(`./${id}/styles.css`, import.meta.url), "utf8");
    const enter = /@keyframes enter\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];
    expect(enter).toBeDefined();
    expect(enter).not.toMatch(/opacity/);
  });
});
