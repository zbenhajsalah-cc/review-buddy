/**
 * Shared test fixtures. The canonical scenario every backend test suite uses:
 * a temp repo whose base commit has `app.ts` = "let x = 1;\nlet y = 2;\n" and
 * whose working tree changes it to y = 20 + a new z line — so the expected
 * hunk is [" let x = 1;", "+let y = 20;", "+let z = 3;"] (vs "-let y = 2;").
 * `sampleReview()` is the matching AgentReview payload. Keep the two in sync.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentReview } from "@review-buddy/core/types";

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

/** AgentReview payload matching makeTempRepo's pending edit. */
export function sampleReview(overrides: Partial<AgentReview> = {}): AgentReview {
  return {
    prologue: {
      why: "y is wrong",
      what: "fix y and add z",
      key_changes: [
        { headline: "Fix y", detail: "20 not 2" },
        { headline: "Add z", detail: "new binding" },
      ],
      review_focus: { summary: "check z is used", file: "app.ts" },
    },
    chapters: [
      {
        index: 1,
        title: "Adjust bindings",
        risk: "Low",
        risk_reason: "tiny",
        description: "edits y and adds z",
        files: [{ path: "app.ts", change_type: "modified" }],
      },
    ],
    ...overrides,
  };
}

/** The viewer URL startServer produces: [1] = port, [2] = token. */
export const VIEWER_URL_RE = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([\w-]+)/;
