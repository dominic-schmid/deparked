import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const RENDERER = fileURLToPath(new URL("../../test-results/lander-renderer.cjs", import.meta.url));

// Playwright compiles JSX for its own component runner, so the renderer is bundled first, the way a Worker gets it.
export default async function bundleRenderer(): Promise<void> {
  await build({
    entryPoints: [fileURLToPath(new URL("./renderer-entry.ts", import.meta.url))],
    outfile: RENDERER,
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
}
