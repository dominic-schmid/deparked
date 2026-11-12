import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A managed domain routes only `<host>/admin*` and `<host>/api/*` to this Worker (everything else is the lander),
// so every URL the admin's pages load must sit under `/admin`: its built files and its server functions.
export default defineConfig({
  build: { assetsDir: "admin/_assets" },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    // The global request middleware checks Origin on every state-changing request, server functions included.
    tanstackStart({ serverFns: { base: "/admin/_serverFn", disableCsrfMiddlewareWarning: true } }),
    react(),
  ],
});
