import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The built app is served by our own Bun server (../src/server/http.ts) from
 * ui/dist — which is exactly where the hook's uiDir() looks. In dev we run
 * `vite` on 5173 and proxy /api to a server started separately via
 * `review-buddy dev` (see README-dev note below).
 */
const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  // Pierre's worker script contains a dynamic import("shiki/wasm") branch;
  // emit workers as ES modules so Vite can bundle that branch when needed.
  worker: {
    format: "es",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Point at a running `review-buddy dev` instance. Override the target
      // with VITE_API_TARGET when the ephemeral port differs.
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:5199",
        changeOrigin: true,
      },
    },
  },
});
