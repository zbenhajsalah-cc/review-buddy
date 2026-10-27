import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

/**
 * Three builds into out/: main (Node, ESM), preload (CommonJS: sandboxed
 * preloads cannot load ES modules) and the renderer (the viewer).
 *
 * Every package is a devDependency, so main and preload bundle all their
 * imports (core, zod) and only `electron` and Node built-ins stay external:
 * the app needs no node_modules at runtime.
 */
export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
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
  },
});
