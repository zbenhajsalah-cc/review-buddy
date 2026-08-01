/**
 * Bundles the backend into a single Node-runnable entry: `dist/cli.mjs`.
 *
 * Why bundle at all — the source is TypeScript with `.ts` import specifiers,
 * which plain Node can't load. Bundling means:
 *  - the Claude Code plugin runs `node dist/cli.mjs` with no install step and
 *    no Bun (a git clone of this repo has no node_modules),
 *  - the npm package works under `npx review-buddy` on any Node ≥ 20,
 *  - schemas/review.schema.json and the package version are inlined, so
 *    nothing has to guess paths at runtime.
 *
 * The viewer (src/ui/dist) is NOT bundled — it is static files the server
 * reads from disk, found by walking up from the entry (see server/session.ts).
 *
 * Run `bun run build:dist`; CI's verify:dist-fresh fails if the committed
 * bundle drifts from source.
 */

import { join } from "node:path";
import { build } from "esbuild";

const root = join(import.meta.dirname, "..");

const result = await build({
  entryPoints: [join(root, "src", "cli", "index.ts")],
  outfile: join(root, "dist", "cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  // Matches the `engines.node` floor in package.json.
  target: "node20",
  // Runtime deps (@modelcontextprotocol/sdk, zod) are bundled in, so a plugin
  // install straight from git needs no `npm install` before first launch.
  packages: "bundle",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: false,
  minify: false,
  logLevel: "info",
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.error(`[build-dist] dist/cli.mjs — ${(bytes / 1024).toFixed(0)} KB`);
