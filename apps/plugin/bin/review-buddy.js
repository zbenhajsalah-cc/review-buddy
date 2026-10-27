#!/usr/bin/env node
/**
 * Thin Node shim so the plugin works with a plain `node` shebang while the
 * real entry runs on Bun (mirrors Plannotator's bin/plannotator.js). Forwards
 * all args + stdin/stdout to `bun dist/hook.js` (the bundled src/cli/index.ts),
 * which dispatches modes (e.g. `open-review` for the PreToolUse hook).
 */
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(path.dirname(__filename), "..");
const entry = path.join(repoRoot, "dist", "hook.js");

if (!fs.existsSync(entry)) {
  console.error(`review-buddy: could not find entry at ${entry}`);
  process.exit(1);
}

const result = childProcess.spawnSync("bun", [entry, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(typeof result.status === "number" ? result.status : 0);
