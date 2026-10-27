import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { binaryPackage, claudeExecutablePath, unpackedPath } from "./executable.ts";

test("binaryPackage names the SDK's platform package", () => {
  expect(binaryPackage("darwin", "arm64")).toBe("@anthropic-ai/claude-agent-sdk-darwin-arm64");
  expect(binaryPackage("win32", "x64")).toBe("@anthropic-ai/claude-agent-sdk-win32-x64");
});

describe("unpackedPath", () => {
  const r = join(sep, "Applications", "Review Buddy.app", "Contents", "Resources");
  test("maps a path inside app.asar to app.asar.unpacked", () => {
    expect(unpackedPath(join(r, "app.asar", "node_modules", "x", "claude"))).toBe(
      join(r, "app.asar.unpacked", "node_modules", "x", "claude"),
    );
  });

  test("leaves other paths alone", () => {
    const dev = join(sep, "repo", "node_modules", "x", "claude");
    expect(unpackedPath(dev)).toBe(dev);
    const already = join(r, "app.asar.unpacked", "x", "claude");
    expect(unpackedPath(already)).toBe(already);
  });
});

test("claudeExecutablePath finds the installed binary for this machine", () => {
  const path = claudeExecutablePath();
  expect(path).toContain(binaryPackage(process.platform, process.arch));
  expect(existsSync(path)).toBe(true);
});

test("claudeExecutablePath throws when the platform package is missing", () => {
  expect(() => claudeExecutablePath("sunos", "mips")).toThrow();
});
