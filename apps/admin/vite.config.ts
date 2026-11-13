import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const CATALOG = resolve(import.meta.dirname, "../sites/public/catalog");
const TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

/**
 * The lander catalog as the admin's own static files at `/catalog/*`, for the editor's preview: its srcdoc frame
 * inherits the admin page's policy (`img-src 'self'`, `font-src 'self'`), so the images and fonts must come from
 * the admin's origin. On a managed domain `/catalog/*` is the pages Worker's copy of the same files; on the
 * admin's own address it is this one. The preview is a sandboxed (opaque) origin, so fonts need CORS.
 */
function catalogAssets(): Plugin {
  const files = readdirSync(CATALOG, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
  return {
    name: "deparked-catalog-assets",
    configureServer(server) {
      server.middlewares.use("/catalog", (request, response, next) => {
        const file = resolve(CATALOG, `.${decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/")}`);
        if (!files.includes(file)) return next();
        response.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      if (this.environment.name !== "client") return;
      for (const file of files) {
        this.emitFile({ type: "asset", fileName: `catalog/${relative(CATALOG, file)}`, source: readFileSync(file) });
      }
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source:
          "/catalog/fonts/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=31536000, immutable\n",
      });
    },
  };
}

interface ArcNode {
  append(node: unknown): unknown;
}
interface ArcRoot extends ArcNode {
  source?: { input: { file?: string } } | undefined;
  nodes: unknown[];
  removeAll(): unknown;
}

/**
 * Arc's component stylesheets (CSS Modules) go into Tailwind's `components` layer, so a utility class on an Arc
 * component (`h-11`, `w-72`) still overrides it, as it did with the shadcn components. The layer order is restated
 * because the first stylesheet to name the layers decides it.
 */
const arcLayer = {
  postcssPlugin: "deparked-arc-layer",
  Once(root: ArcRoot, { AtRule }: { AtRule: new (init: { name: string; params: string }) => ArcNode }) {
    if (!/\/components\/arc\/.+\.module\.css$/.test((root.source?.input.file ?? "").replaceAll("\\", "/"))) return;
    const layer = new AtRule({ name: "layer", params: "components" });
    for (const node of [...root.nodes]) layer.append(node);
    root.removeAll();
    root.append(new AtRule({ name: "layer", params: "theme, base, components, utilities" }));
    root.append(layer);
  },
};

// A managed domain routes only `<host>/admin*` and `<host>/api/*` to this Worker (everything else is the lander),
// so every URL the admin's pages load must sit under `/admin`: its built files and its server functions.
export default defineConfig({
  build: { assetsDir: "admin/_assets" },
  css: { postcss: { plugins: [arcLayer] } },
  plugins: [
    catalogAssets(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    // The global request middleware checks Origin on every state-changing request, server functions included.
    tanstackStart({ serverFns: { base: "/admin/_serverFn", disableCsrfMiddlewareWarning: true } }),
    react(),
  ],
});
