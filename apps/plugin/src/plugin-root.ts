/**
 * Locate the plugin root (the directory holding .claude-plugin/plugin.json) by
 * walking up from this module. A fixed "../.." would only be right from one
 * place: this code runs both from source (src/…) and from the committed
 * bundles (dist/…), whose import.meta.dir differs.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Absolute plugin root, or null when this module isn't inside the plugin. */
export function pluginRoot(): string | null {
  let dir = import.meta.dir;
  while (!existsSync(join(dir, ".claude-plugin", "plugin.json"))) {
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return dir;
}
