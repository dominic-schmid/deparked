declare module "subset-font" {
  export default function subsetFont(
    font: Buffer,
    text: string,
    options: {
      targetFormat: "woff2" | "woff" | "sfnt" | "truetype";
      variationAxes?: Record<string, number | { min: number; max: number }>;
    },
  ): Promise<Buffer>;
}
