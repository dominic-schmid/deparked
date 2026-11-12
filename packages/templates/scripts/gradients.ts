import type { CatalogGradient } from "../src/catalog.ts";

// Presets for the gradient-led variants, drawn from the Sky photo's palette: its blues, the olive of the trees,
// the warm light in the clouds. Each is a few soft radial light sources over a linear base, so the field has depth
// without an image. `color` is the flat fallback and the theme colour. `tone` is checked, not guessed: every stop
// that type can sit on keeps 4.5:1 against white (`dark`) or against the ink #1c2116 (`light`).
export const GRADIENTS: CatalogGradient[] = [
  {
    id: "dawn",
    name: "Dawn",
    color: "#e9dfd8",
    tone: "light",
    css: "radial-gradient(90% 70% at 8% 0%, #fbd6b8 0%, rgb(251 214 184 / 0) 62%), radial-gradient(80% 80% at 96% 12%, #b4cbe6 0%, rgb(180 203 230 / 0) 66%), radial-gradient(110% 80% at 70% 112%, #f2bd9c 0%, rgb(242 189 156 / 0) 62%), linear-gradient(172deg, #dfe7ee 0%, #eee3da 52%, #f3d9c6 100%)",
  },
  {
    id: "tide",
    name: "Tide",
    color: "#c3d9d3",
    tone: "light",
    css: "radial-gradient(80% 70% at 88% 6%, #eef4e6 0%, rgb(238 244 230 / 0) 60%), radial-gradient(90% 90% at 4% 96%, #98c1bb 0%, rgb(152 193 187 / 0) 66%), radial-gradient(70% 60% at 30% 20%, #d5e6e8 0%, rgb(213 230 232 / 0) 60%), linear-gradient(160deg, #cfe2de 0%, #b9d4cf 52%, #d8e5d1 100%)",
  },
  {
    id: "meadow",
    name: "Meadow",
    color: "#2f4021",
    tone: "dark",
    css: "radial-gradient(70% 60% at 12% 10%, #5a7442 0%, rgb(90 116 66 / 0) 62%), radial-gradient(80% 70% at 94% 88%, #35506a 0%, rgb(53 80 106 / 0) 66%), linear-gradient(165deg, #3c4f2c 0%, #2a3a1d 55%, #1b2612 100%)",
  },
  {
    id: "ember",
    name: "Ember",
    color: "#4a190d",
    tone: "dark",
    css: "radial-gradient(75% 65% at 88% 6%, #b4532f 0%, rgb(180 83 47 / 0) 62%), radial-gradient(70% 70% at 0% 100%, #7c2914 0%, rgb(124 41 20 / 0) 62%), radial-gradient(60% 50% at 30% 30%, #5e1f0f 0%, rgb(94 31 15 / 0) 70%), linear-gradient(200deg, #6b2412 0%, #3d150b 60%, #22100a 100%)",
  },
  {
    id: "dusk",
    name: "Dusk",
    color: "#1b2430",
    tone: "dark",
    css: "radial-gradient(95% 60% at 50% 118%, #a9643c 0%, rgb(169 100 60 / 0) 64%), radial-gradient(80% 70% at 6% 0%, #46658c 0%, rgb(70 101 140 / 0) 64%), radial-gradient(60% 50% at 96% 30%, #2c4258 0%, rgb(44 66 88 / 0) 70%), linear-gradient(180deg, #1c2838 0%, #18202b 55%, #241a17 100%)",
  },
];
