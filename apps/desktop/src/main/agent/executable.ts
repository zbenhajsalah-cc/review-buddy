/**
 * Where the Claude Code binary is. The Agent SDK runs Claude Code as a child
 * process; its binary comes in a per-platform package
 * (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`, an optional dependency
 * of the SDK). The SDK finds it with `require.resolve`, which in a packaged app
 * points inside `app.asar`, and a file inside an asar archive cannot be run.
 * electron-builder unpacks it (`asarUnpack` in electron-builder.yml) next to the
 * archive, in `app.asar.unpacked`, so we resolve it ourselves and pass the
 * unpacked path as `pathToClaudeCodeExecutable`.
 *
 * No Electron imports: tested with bun.
 */
import { createRequire } from "node:module";
import { sep } from "node:path";

/** The SDK's platform package for this machine (Electron is never musl). */
export function binaryPackage(platform: string, arch: string): string {
  return `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
}

/** A path inside app.asar, mapped to the same path in app.asar.unpacked. */
export function unpackedPath(path: string): string {
  return path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);
}

/**
 * The binary's path, resolved the way the SDK does it: `<package>/claude` from
 * the SDK's entry file (with pnpm, the platform package is only visible from
 * there).
 */
export function claudeExecutablePath(
  platform: string = process.platform,
  arch: string = process.arch,
  resolveFrom: string = import.meta.url,
): string {
  const sdkEntry = createRequire(resolveFrom).resolve("@anthropic-ai/claude-agent-sdk");
  const binary = platform === "win32" ? "claude.exe" : "claude";
  return unpackedPath(
    createRequire(sdkEntry).resolve(`${binaryPackage(platform, arch)}/${binary}`),
  );
}
