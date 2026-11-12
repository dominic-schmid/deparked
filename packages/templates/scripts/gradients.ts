import type { CatalogGradient } from "../src/catalog.ts";

// Presets for the gradient-led variants, drawn from the Sky photo's palette: its blues, the olive of the trees
// and the warm tones of the error states. `color` is the flat fallback and the theme colour.
export const GRADIENTS: CatalogGradient[] = [
  {
    id: "dawn",
    name: "Dawn",
    color: "#7f9fbf",
    css: "linear-gradient(180deg, #5f86b3 0%, #7f9fbf 38%, #c9d3d0 72%, #f1d9c4 100%)",
  },
  {
    id: "meadow",
    name: "Meadow",
    color: "#4d6138",
    css: "linear-gradient(165deg, #7f9fbf 0%, #8aa38f 42%, #4d6138 78%, #2c3a1a 100%)",
  },
  {
    id: "ember",
    name: "Ember",
    color: "#b5573a",
    css: "radial-gradient(120% 90% at 20% 0%, #ffd2c2 0%, #ffb39b 28%, #b5573a 68%, #4a1d10 100%)",
  },
  {
    id: "dusk",
    name: "Dusk",
    color: "#1d2614",
    css: "linear-gradient(200deg, #3d5878 0%, #2a3a44 45%, #1d2614 100%)",
  },
];
