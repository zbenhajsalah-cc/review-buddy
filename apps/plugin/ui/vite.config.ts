import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The built app is served by our own Bun server (../src/server/http.ts) from
 * ui/dist — which is exactly where the hook's uiDir() looks. In dev we run
 * `vite` on 5173 and proxy /api to a server started separately via
 * `review-buddy dev` (see README-dev note below).
 *
 * The viewer itself is @review-buddy/viewer (packages/viewer), built here
 * from source; src/main.tsx only mounts it with the HTTP ReviewApi.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // One React for the entry and the viewer package.
    dedupe: ["react", "react-dom"],
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
