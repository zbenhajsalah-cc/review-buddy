/**
 * Test fixture shared by core and plugin tests: a temp repo whose base commit
 * has `app.ts` = "let x = 1;\nlet y = 2;\n" and whose working tree changes it
 * to y = 20 + a new z line — so the expected hunk is
 * [" let x = 1;", "+let y = 20;", "+let z = 3;"] (vs "-let y = 2;").
 * The plugin's `sampleReview()` (src/test-helpers.ts) is the matching
 * AgentReview payload. Keep the two in sync.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Run git in `cwd` (test-grade: throws on failure, returns stdout). */
export function testGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** Temp repo with the canonical base commit + pending working-tree edit. */
export function makeTempRepo(prefix = "rb-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  testGit(dir, "init", "-q");
  testGit(dir, "config", "user.email", "t@t.t");
  testGit(dir, "config", "user.name", "t");
  testGit(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "app.ts"), "let x = 1;\nlet y = 2;\n");
  testGit(dir, "add", "-A");
  testGit(dir, "commit", "-q", "-m", "base");
  writeFileSync(join(dir, "app.ts"), "let x = 1;\nlet y = 20;\nlet z = 3;\n");
  return dir;
}
