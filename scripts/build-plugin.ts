/**
 * Bundles the plugin's two entry points into self-contained files under dist/:
 *
 *   dist/server.js  ← src/mcp/server.ts  (MCP server; plugin.json + integrations/)
 *   dist/hook.js    ← src/cli/index.ts   (PreToolUse hook + `dev`; hooks.json, bin/)
 *
 * Everything is inlined — @review-buddy/core, zod, the MCP SDK, the review JSON
 * schema — so an installed plugin needs no `node_modules` and never
 * auto-installs (which would also pick the newest versions in range, not the
 * ones we tested). The bundles are committed, like src/ui/dist: Claude Code
 * plugin installs are git clones with no build step. CI's verify:dist-fresh
 * fails when they drift from source; rebuild with `pnpm build:plugin` using the
 * Bun version in .bun-version (the output is deterministic per Bun version).
 *
 * Not minified: readable stack traces in bug reports, and small text deltas
 * in git when the source changes.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist");

const ENTRIES = [
  { entry: "src/mcp/server.ts", out: "server.js" },
  { entry: "src/cli/index.ts", out: "hook.js" },
];

rmSync(outdir, { recursive: true, force: true });

for (const { entry, out } of ENTRIES) {
  const result = await Bun.build({
    entrypoints: [join(root, entry)],
    outdir,
    naming: out,
    target: "bun",
    banner: `// GENERATED from ${entry} by scripts/build-plugin.ts — do not edit; run \`pnpm build:plugin\`.`,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  console.log(`[build-plugin] wrote dist/${out}`);
}
