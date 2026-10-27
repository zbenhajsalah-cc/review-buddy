import { expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiff } from "@review-buddy/core/diff";
import { makeTempRepo } from "../test-helpers.ts";
import {
  assertPrRef,
  assertSafeRef,
  captureDiff,
  capturePr,
  capturePrDiff,
  ensureCommit,
  fileContent,
  resolveBase,
} from "./git.ts";

test("assertSafeRef rejects flag-smuggling refs, accepts real refs", () => {
  expect(() => assertSafeRef("-O/tmp/x")).toThrow();
  expect(() => assertSafeRef("--upload-pack=touch pwned")).toThrow();
  expect(() => assertSafeRef("")).toThrow();
  expect(() => assertSafeRef("main")).not.toThrow();
  expect(() => assertSafeRef("origin/feature-x")).not.toThrow();
  expect(() => assertSafeRef("HEAD~1")).not.toThrow();
});

test("resolveBase rejects a flag-smuggling override before git runs", () => {
  expect(() => resolveBase(".", "--upload-pack=x")).toThrow();
});

test("fileContent rejects an unsafe base ref before git runs", () => {
  expect(() => fileContent(".", "f", "base", "-Oevil")).toThrow();
});

test("fileContent (head) rejects a ref that smells like a flag", () => {
  const repo = makeTempRepo("rb-headref-");
  expect(() => fileContent(repo, "app.ts", "head", "HEAD", "-evil-flag")).toThrow("unsafe");
  rmSync(repo, { recursive: true, force: true });
});

test("assertPrRef accepts a number or github PR URL, rejects the rest", () => {
  expect(() => assertPrRef("42")).not.toThrow();
  expect(() => assertPrRef("https://github.com/owner/repo/pull/7")).not.toThrow();
  expect(() => assertPrRef("--web")).toThrow();
  expect(() => assertPrRef("main")).toThrow();
  expect(() => assertPrRef("https://evil.com/pull/1")).toThrow();
});

test("capturePrDiff refuses an unsafe ref before shelling out to gh", () => {
  // Throws on validation — never reaches `gh`, so no network/auth needed.
  expect(() => capturePrDiff(process.cwd(), "--upload-pack=x")).toThrow();
});

test("captureDiff includes untracked files with special-character names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-git-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "a.ts"), "base\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");

    writeFileSync(join(dir, "café.ts"), "café\n");
    writeFileSync(join(dir, "with space.ts"), "space\n");
    writeFileSync(join(dir, "plain.ts"), "plain\n");

    const diff = await captureDiff(dir, "HEAD");
    const files = parseDiff(diff)
      .map((f) => f.path)
      .sort();
    expect(files).toEqual(["café.ts", "plain.ts", "with space.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("captureDiff folds in multiple untracked files (concurrent, none dropped)", async () => {
  const repo = makeTempRepo("rb-untracked-");
  writeFileSync(join(repo, "u1.txt"), "one\n");
  writeFileSync(join(repo, "u2.txt"), "two\n");
  const diff = await captureDiff(repo, "HEAD");
  expect(diff).toContain("+++ b/u1.txt");
  expect(diff).toContain("+++ b/u2.txt");
  expect(diff).toContain("+one");
  expect(diff).toContain("+two");
  rmSync(repo, { recursive: true, force: true });
});

test("fileContent (worktree head) refuses a symlink escaping the repo", () => {
  const repo = makeTempRepo("rb-symlink-");
  const outside = mkdtempSync(join(tmpdir(), "rb-outside-"));
  const secret = join(outside, "secret.txt");
  writeFileSync(secret, "SENSITIVE");
  symlinkSync(secret, join(repo, "leak.txt"));
  const out = fileContent(repo, "leak.txt", "head", "HEAD", undefined);
  expect(out).toBe(""); // never the secret's bytes
  rmSync(outside, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

test("fileContent (worktree head) still reads a normal in-repo file", () => {
  const repo = makeTempRepo("rb-normal-");
  const out = fileContent(repo, "app.ts", "head", "HEAD", undefined);
  expect(out).toContain("let z = 3;");
  rmSync(repo, { recursive: true, force: true });
});

test("fileContent head side reads a git object when a headRef SHA is given", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-git-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    // Commit content A, capture its SHA, then overwrite the worktree with B.
    writeFileSync(join(dir, "f.ts"), "AAA\n");
    git("add", "-A");
    git("commit", "-q", "-m", "A");
    const sha = git("rev-parse", "HEAD").trim();
    writeFileSync(join(dir, "f.ts"), "BBB\n"); // worktree now differs from the commit

    // SHA given → reads the committed object (A), NOT the worktree (B).
    expect(fileContent(dir, "f.ts", "head", "HEAD", sha)).toBe("AAA\n");
    // null → PR mode, unavailable → "" (never leaks the worktree bytes).
    expect(fileContent(dir, "f.ts", "head", "HEAD", null)).toBe("");
    // undefined → worktree mode → reads the working tree (B).
    expect(fileContent(dir, "f.ts", "head", "HEAD")).toBe("BBB\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureCommit resolves an existing commit, fails open for an unknown one", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-git-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "f.ts"), "x\n");
    git("add", "-A");
    git("commit", "-q", "-m", "c");
    const sha = git("rev-parse", "HEAD").trim();

    expect(ensureCommit(dir, sha)).toBe(true);
    // No such object; the fetch fallbacks run `git fetch origin` in a repo with
    // NO remote and degrade quietly (allowFail) → false.
    expect(ensureCommit(dir, "deadbeef".repeat(5))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.serial("capturePr parses gh pr view JSON when available", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-git-"));
  try {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "f.ts"), "x\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");

    // Bun's execFileSync ignores runtime PATH mutations (oven-sh/bun#29237), so a
    // fake `gh` on PATH is not picked up. Intercept the gh call instead.
    const origExec = childProcess.execFileSync;
    const ghSpy = spyOn(childProcess, "execFileSync").mockImplementation(((
      cmd: string,
      args?: readonly string[],
      opts?: Parameters<typeof origExec>[2],
    ) => {
      if (cmd === "gh") {
        return '{"title":"T","body":"B","author":{"login":"alice"},"baseRefName":"main","headRefName":"feat"}\n';
      }
      return origExec(cmd, args ?? [], opts);
    }) as typeof origExec);

    const pr = capturePr(dir, "fallback-base");
    expect(pr.title).toBe("T");
    expect(pr.author).toBe("alice");
    expect(pr.base).toBe("main");
    expect(pr.head).toBe("feat");
    ghSpy.mockRestore();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.serial("capturePr falls back to local git when gh yields no JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-git-"));
  try {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "f.ts"), "x\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    writeFileSync(join(dir, "f.ts"), "y\n");
    git("add", "-A");
    git("commit", "-q", "-m", "my subject");

    // gh yields no JSON → capturePr must fall back to local git (last commit
    // subject as title, `git config user.name` as author). Intercept gh the same
    // way as the happy path; delegate real git calls.
    const origExec = childProcess.execFileSync;
    const ghSpy = spyOn(childProcess, "execFileSync").mockImplementation(((
      cmd: string,
      args?: readonly string[],
      opts?: Parameters<typeof origExec>[2],
    ) => {
      if (cmd === "gh") return ""; // no JSON → fallback
      return origExec(cmd, args ?? [], opts);
    }) as typeof origExec);

    const pr = capturePr(dir, "fallback-base");
    expect(pr.title).toBe("my subject");
    expect(pr.author).toBe("t");
    ghSpy.mockRestore();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
