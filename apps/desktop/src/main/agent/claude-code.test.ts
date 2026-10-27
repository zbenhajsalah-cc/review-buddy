import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeCodeStatus } from "../../shared/ipc.ts";
import {
  ClaudeCode,
  checkClaudeCode,
  claudeCandidates,
  compareVersions,
  parseClaudeVersion,
} from "./claude-code.ts";
import { sdkClaudeCodeVersion } from "./sdk-version.ts";

const NOW = () => new Date("2026-10-27T12:00:00Z");

describe("claudeCandidates", () => {
  test("PATH first, then the usual install folders (a Dock app has no shell PATH)", () => {
    const list = claudeCandidates("darwin", { PATH: "/usr/bin:/custom/bin" }, "/Users/me");
    expect(list).toEqual([
      "/usr/bin/claude",
      "/custom/bin/claude",
      "/Users/me/.local/bin/claude",
      "/Users/me/.claude/local/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ]);
  });

  test("no doubles", () => {
    const list = claudeCandidates(
      "linux",
      { PATH: "/usr/local/bin:/home/me/.local/bin" },
      "/home/me",
    );
    expect(new Set(list).size).toBe(list.length);
  });

  test("Windows: claude.exe, PATH with ';', then %USERPROFILE%\\.local\\bin", () => {
    const list = claudeCandidates(
      "win32",
      { Path: "C:\\Tools;C:\\Bin", USERPROFILE: "C:\\Users\\me" },
      "C:\\ignored",
    );
    expect(list).toEqual([
      "C:\\Tools\\claude.exe",
      "C:\\Bin\\claude.exe",
      "C:\\Users\\me\\.local\\bin\\claude.exe",
    ]);
  });
});

test("parseClaudeVersion reads `claude --version`", () => {
  expect(parseClaudeVersion("2.1.311 (Claude Code)\n")).toBe("2.1.311");
  expect(parseClaudeVersion("  10.0.1 (Claude Code)")).toBe("10.0.1");
  for (const bad of ["", "2.1.311", "gh version 2.1.0", "v2.1.311 (Claude Code)", "Claude Code"]) {
    expect(parseClaudeVersion(bad)).toBeNull();
  }
});

test("compareVersions compares numbers, not text", () => {
  expect(compareVersions("2.1.296", "2.1.296")).toBe(0);
  expect(compareVersions("2.1.311", "2.1.296")).toBeGreaterThan(0);
  expect(compareVersions("2.1.99", "2.1.296")).toBeLessThan(0);
  expect(compareVersions("2.10.0", "2.9.9")).toBeGreaterThan(0);
  expect(compareVersions("3.0.0", "2.99.99")).toBeGreaterThan(0);
});

test("sdkClaudeCodeVersion reads the SDK's own Claude Code version", () => {
  expect(sdkClaudeCodeVersion()).toMatch(/^\d+\.\d+\.\d+$/);
});

describe.skipIf(process.platform === "win32")("checkClaudeCode with fake claude scripts", () => {
  const root = mkdtempSync(join(tmpdir(), "rb-claude-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let n = 0;
  /** A folder with a `claude` that runs `script`. */
  const fake = (script: string, mode = 0o755) => {
    const dir = join(root, String(n++));
    mkdirSync(dir);
    const path = join(dir, "claude");
    writeFileSync(path, `#!/bin/sh\n${script}\n`);
    chmodSync(path, mode);
    return { dir, path };
  };
  const home = join(root, "home");
  const check = (dirs: string[], chosen?: string) =>
    checkClaudeCode({
      minVersion: "2.1.296",
      chosen,
      platform: "linux",
      env: { PATH: dirs.join(":") },
      home,
      now: NOW,
    });

  test("ok: the version, the path, when", async () => {
    const good = fake('echo "2.1.311 (Claude Code)"');
    expect(await check([good.dir])).toEqual({
      state: "ok",
      path: good.path,
      version: "2.1.311",
      minVersion: "2.1.296",
      chosen: false,
      checkedAt: "2026-10-27T12:00:00.000Z",
    });
  });

  test("exactly the SDK's version is enough", async () => {
    expect((await check([fake('echo "2.1.296 (Claude Code)"').dir])).state).toBe("ok");
  });

  test("not found: says what to do and where it looked", async () => {
    const status = await check([join(root, "nothing-here")]);
    expect(status.state).toBe("missing");
    expect(status.message).toBe(
      "Review Buddy uses your Claude Code. Install it, then press Check again.",
    );
    expect(status.searched).toContain(join(root, "nothing-here", "claude"));
    expect(status.searched).toContain(join(home, ".local", "bin", "claude"));
  });

  test("too old: the version, the one needed, and `claude update`", async () => {
    const old = fake('echo "2.1.200 (Claude Code)"');
    const status = await check([old.dir]);
    expect(status).toMatchObject({ state: "too-old", version: "2.1.200", path: old.path });
    expect(status.message).toBe(
      "Claude Code 2.1.200 is too old for this app (needs 2.1.296 or newer). " +
        "Run `claude update`, then press Check again.",
    );
  });

  test("an old one first in the PATH, a good one later: the good one", async () => {
    const old = fake('echo "2.1.200 (Claude Code)"');
    const good = fake('echo "2.1.300 (Claude Code)"');
    expect(await check([old.dir, good.dir])).toMatchObject({ state: "ok", path: good.path });
  });

  test("broken: another program, a failing one, one that cannot run", async () => {
    const other = fake('echo "claude 1.0 (not that one)"');
    expect(await check([other.dir])).toMatchObject({ state: "broken", path: other.path });
    expect((await check([other.dir])).message).toContain("claude 1.0 (not that one)");
    const failing = fake('echo "boom" >&2; exit 3');
    expect((await check([failing.dir])).message).toContain("boom");
    const notExecutable = fake('echo "2.1.311 (Claude Code)"', 0o644);
    expect(await check([notExecutable.dir])).toMatchObject({ state: "broken" });
  });

  test("a chosen binary is the only one checked", async () => {
    const good = fake('echo "2.1.311 (Claude Code)"');
    const old = fake('echo "2.1.200 (Claude Code)"');
    expect(await check([good.dir], old.path)).toMatchObject({
      state: "too-old",
      path: old.path,
      chosen: true,
    });
    const gone = join(root, "gone", "claude");
    const status = await check([good.dir], gone);
    expect(status).toMatchObject({ state: "missing", chosen: true, searched: [gone] });
    expect(status.message).toContain(gone);
  });
});

describe("ClaudeCode", () => {
  const status = (state: ClaudeCodeStatus["state"], path?: string): ClaudeCodeStatus => ({
    state,
    path,
    version: state === "ok" ? "2.1.311" : undefined,
    minVersion: "2.1.296",
    chosen: false,
    message: state === "ok" ? undefined : `${state}: do this`,
    checkedAt: NOW().toISOString(),
  });

  const setup = (states: ClaudeCodeStatus[]) => {
    let chosenPath: string | undefined;
    const seen: (string | undefined)[] = [];
    const claude = new ClaudeCode({
      minVersion: "2.1.296",
      chosen: {
        get: async () => chosenPath,
        set: async (path) => {
          chosenPath = path;
        },
      },
      check: async ({ chosen }) => {
        seen.push(chosen);
        return states.shift() ?? status("missing");
      },
    });
    return { claude, seen };
  };

  test("status checks once, then answers the last check", async () => {
    const { claude, seen } = setup([status("ok", "/a/claude")]);
    expect((await claude.status()).path).toBe("/a/claude");
    expect((await claude.status()).path).toBe("/a/claude");
    expect(seen).toHaveLength(1);
  });

  test("calls at the same time share one check", async () => {
    const { claude, seen } = setup([status("ok", "/a/claude")]);
    await Promise.all([claude.check(), claude.check(), claude.status()]);
    expect(seen).toHaveLength(1);
  });

  test("ready checks again: the path and version, or a 'claude' error with the message", async () => {
    const { claude } = setup([status("ok", "/a/claude"), status("too-old", "/a/claude")]);
    expect(await claude.ready()).toEqual({ path: "/a/claude", version: "2.1.311" });
    const error = await claude.ready().catch((e: Error & { kind?: string }) => e);
    expect(error).toMatchObject({ message: "too-old: do this", kind: "claude" });
    expect((await claude.status()).state).toBe("too-old");
  });

  test("choose keeps the path and checks it; undefined searches again", async () => {
    const { claude, seen } = setup([status("ok", "/mine/claude"), status("ok", "/a/claude")]);
    await claude.choose("/mine/claude");
    await claude.choose(undefined);
    expect(seen).toEqual(["/mine/claude", undefined]);
  });
});
