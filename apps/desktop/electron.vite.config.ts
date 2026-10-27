import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

/**
 * Three builds into out/: main (Node, ESM), preload (CommonJS: sandboxed
 * preloads cannot load ES modules) and the renderer (the viewer).
 *
 * electron-vite keeps `dependencies` external and bundles the rest. Every
 * package but the Agent SDK is a devDependency, so main and preload bundle
 * their imports (core, zod); the SDK stays in node_modules next to its Claude
 * Code binary. `electron` and Node built-ins are external too.
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
