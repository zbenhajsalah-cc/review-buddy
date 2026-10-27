/**
 * The Claude Code version the Agent SDK is built with (`claudeCodeVersion` in
 * its package.json): the oldest installed Claude Code the app accepts (US-21).
 * Read when the app is built (electron.vite.config.ts puts it in main as
 * `__CLAUDE_CODE_MIN_VERSION__`), so it follows SDK updates by itself.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export function sdkClaudeCodeVersion(resolveFrom: string = import.meta.url): string {
  // The package's exports do not include package.json: go from its entry file.
  const entry = createRequire(resolveFrom).resolve("@anthropic-ai/claude-agent-sdk");
  const pkg = JSON.parse(readFileSync(join(dirname(entry), "package.json"), "utf8")) as {
    claudeCodeVersion?: unknown;
  };
  const version = pkg.claudeCodeVersion;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`The Agent SDK's package.json has no claudeCodeVersion (${String(version)}).`);
  }
  return version;
}
