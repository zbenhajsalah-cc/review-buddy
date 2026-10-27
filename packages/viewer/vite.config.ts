import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Only used by Storybook. The apps build the viewer from source with their own
 * Vite config (see apps/plugin/ui/vite.config.ts).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pierre's worker script contains a dynamic import("shiki/wasm") branch;
  // emit workers as ES modules so Vite can bundle that branch when needed.
  worker: {
    format: "es",
  },
});
