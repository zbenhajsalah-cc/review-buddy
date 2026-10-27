import { afterEach, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { rmSync } from "node:fs";
import { localGitSource } from "./local-source.ts";
import { makeTempRepo, testGit } from "./test-repo.ts";

const dirs: string[] = [];
const repo = () => {
  const dir = makeTempRepo("rb-src-");
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Fake `gh` (Bun's execFileSync ignores runtime PATH mutations, so a fake gh on
 * PATH is not picked up — see git.test.ts). Real git calls pass through.
 */
function fakeGh(view: object, diff: string) {
  const origExec = childProcess.execFileSync;
  return spyOn(childProcess, "execFileSync").mockImplementation(((
    cmd: string,
    args?: readonly string[],
    opts?: Parameters<typeof origExec>[2],
  ) => {
    if (cmd === "gh") return args?.[1] === "view" ? JSON.stringify(view) : diff;
    return origExec(cmd, args ?? [], opts);
  }) as typeof origExec);
}

test("worktree: diffs the working tree against HEAD and reads both sides", async () => {
  const dir = repo();
  const src = localGitSource(dir);
  expect(src.base).toBe("HEAD");
  expect(src.headRef).toBeUndefined();
  expect(await src.diff()).toContain("+let y = 20;");
  expect((await src.pr()).base).toBe("HEAD");
  expect(await src.fileContent("app.ts", "base")).toBe("let x = 1;\nlet y = 2;\n");
  expect(await src.fileContent("app.ts", "head")).toBe("let x = 1;\nlet y = 20;\nlet z = 3;\n");
});

test("worktree: baseOverride replaces HEAD as the base", async () => {
  const dir = repo();
  const sha = testGit(dir, "rev-parse", "HEAD").trim();
  expect(localGitSource(dir, { type: "worktree" }, sha).base).toBe(sha);
});

test("branch: diffs against the given ref", async () => {
  const dir = repo();
  testGit(dir, "commit", "-qam", "change");
  const src = localGitSource(dir, { type: "branch", ref: "HEAD~1" });
  expect(src.base).toBe("HEAD~1");
  expect(await src.diff()).toContain("+let z = 3;");
  expect(await src.fileContent("app.ts", "base")).toBe("let x = 1;\nlet y = 2;\n");
});

test("branch: rejects a flag-smuggling ref before git runs", () => {
  expect(() => localGitSource(".", { type: "branch", ref: "--upload-pack=x" })).toThrow();
});

test.serial("pr: uses gh for the diff and reads the head side from the PR commit", async () => {
  const dir = repo();
  testGit(dir, "commit", "-qam", "pr head");
  const sha = testGit(dir, "rev-parse", "HEAD").trim();
  testGit(dir, "reset", "-q", "--hard", "HEAD~1"); // worktree ≠ PR head
  const gh = fakeGh(
    {
      title: "T",
      body: "B",
      author: { login: "a" },
      baseRefName: "main",
      headRefName: "feat",
      headRefOid: sha,
    },
    "diff --git a/app.ts b/app.ts\n",
  );
  try {
    const src = localGitSource(dir, { type: "pr", ref: "7" });
    expect(src.headRef).toBe(sha);
    expect(src.base).toBe("main"); // no origin → merge-base unavailable → base branch name
    expect(await src.diff()).toBe("diff --git a/app.ts b/app.ts\n");
    expect((await src.pr()).title).toBe("T");
    expect(await src.fileContent("app.ts", "head")).toBe("let x = 1;\nlet y = 20;\nlet z = 3;\n");
  } finally {
    gh.mockRestore();
  }
});

test.serial("pr: head commit unavailable → head reads are empty, never the worktree", async () => {
  const dir = repo();
  const gh = fakeGh(
    { title: "T", baseRefName: "main", headRefOid: "0123456789abcdef0123456789abcdef01234567" },
    "",
  );
  try {
    const src = localGitSource(dir, { type: "pr", ref: "7" });
    expect(src.headRef).toBeNull();
    expect(await src.fileContent("app.ts", "head")).toBe("");
  } finally {
    gh.mockRestore();
  }
});
