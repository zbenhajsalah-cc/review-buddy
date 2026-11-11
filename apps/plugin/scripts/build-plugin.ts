/**
 * Bundles the plugin's two entry points into self-contained files under dist/:
 *
 *   dist/server.js  ← src/mcp/server.ts  (MCP server; plugin.json + integrations/)
 *   dist/hook.js    ← src/cli/index.ts   (PreToolUse hook + `dev`; hooks.json, bin/)
 *
 * Everything is inlined — @review-buddy/core, zod, the MCP SDK, the review JSON
 * schema — so an installed plugin needs no `node_modules` and never
 * auto-installs (which would also pick the newest versions in range, not the
 * ones we tested). The bundles are committed, like ui/dist: Claude Code
 * plugin installs are git clones with no build step. CI's verify:dist-fresh
 * fails when they drift from source; rebuild with `pnpm build:plugin` using the
 * Bun version in .bun-version (the output is deterministic per Bun version, so
 * this script refuses to run under any other — see assertPinnedBun below).
 *
 * Not minified: readable stack traces in bug reports, and small text deltas
 * in git when the source changes.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist");
/** The repo root — only reachable in the workspace, not in a plugin install. */
const repoRoot = join(root, "..", "..");

/** The Bun version this repo builds with, or undefined outside the workspace. */
function pinnedBunVersion(): string | undefined {
  try {
    return readFileSync(join(repoRoot, ".bun-version"), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refuse to build with a Bun other than the pinned one.
 *
 * `bun build`'s output is not byte-identical across Bun versions, and these
 * bundles are committed, so the wrong Bun rewrites every line of dist/ with
 * churn that nothing local catches: `verify:dist-fresh` compares your output
 * against your own rebuild, so it passes, and the mismatch only surfaces as a
 * red CI run after the push (CI builds with .bun-version). Fail here instead.
 *
 * Set REVIEW_BUDDY_BUN_MISMATCH=allow to build anyway — when deliberately
 * trying a new Bun, which means bumping .bun-version in the same change.
 */
function assertPinnedBun(): void {
  const pinned = pinnedBunVersion();
  if (!pinned || pinned === Bun.version) return;
  if (process.env.REVIEW_BUDDY_BUN_MISMATCH === "allow") {
    console.warn(
      `[build-plugin] WARNING: building with Bun ${Bun.version}, not the pinned ${pinned}; dist/ will not match CI.`,
    );
    return;
  }
  console.error(
    [
      `[build-plugin] Bun ${Bun.version} does not match .bun-version (${pinned}).`,
      "",
      "  bun build's output differs between Bun versions and apps/plugin/dist/ is",
      "  committed, so this build would commit churn that only CI catches.",
      "",
      `  Build with the pinned Bun:  bunx bun@${pinned} run scripts/build-plugin.ts`,
      `  Or install it:              bun upgrade --to ${pinned}`,
      "  Deliberately moving Bun?    bump .bun-version, or set REVIEW_BUDDY_BUN_MISMATCH=allow",
    ].join("\n"),
  );
  process.exit(1);
}

assertPinnedBun();

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
