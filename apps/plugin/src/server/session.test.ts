import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentReview } from "@review-buddy/core/types";
import { roundStore } from "./round-store.ts";
import { openRounds, roundtripEnabled } from "./session.ts";

test("roundtripEnabled: on by default, off only when turned off", () => {
  expect(roundtripEnabled({})).toBe(true);
  for (const on of ["", "1", "true", "yes", "on"]) {
    expect(roundtripEnabled({ REVIEW_BUDDY_ROUNDTRIP: on })).toBe(true);
  }
  for (const off of ["0", "false", "off", "no", " OFF ", "False"]) {
    expect(roundtripEnabled({ REVIEW_BUDDY_ROUNDTRIP: off })).toBe(false);
  }
});

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 ctx
+added
diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,3 @@
 ctx
+also
`;
/** The same change with src/b.ts fixed — src/a.ts untouched. */
const DIFF_B_CHANGED = DIFF.replace("+also", "+fixed");

const agent = { source: { type: "worktree" } } as AgentReview;

/** Each test gets its own state folder, so rounds never leak between them. */
function withStateDir<T>(run: () => T): T {
  const previous = process.env.REVIEW_BUDDY_STATE_DIR;
  const dir = mkdtempSync(join(tmpdir(), "rb-session-"));
  process.env.REVIEW_BUDDY_STATE_DIR = dir;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.REVIEW_BUDDY_STATE_DIR;
    else process.env.REVIEW_BUDDY_STATE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("openRounds: the first review of a change is no round at all", () => {
  withStateDir(() => {
    expect(openRounds("/repo", agent, DIFF).info).toBeUndefined();
  });
});

test("openRounds: request changes, then re-open — round 2, with the untouched file still viewed", () => {
  withStateDir(() => {
    const first = openRounds("/repo", agent, DIFF);
    first.save({
      verdict: "request_changes",
      summary: "fix b",
      viewed: ["src/a.ts", "src/b.ts"],
      comments: [{ chapterIndex: 0, path: "src/b.ts", side: "new", line: 2, body: "Why?" }],
    });

    const second = openRounds("/repo", agent, DIFF_B_CHANGED);
    expect(second.info).toEqual({
      number: 2,
      changedPaths: ["src/b.ts"],
      viewedPaths: ["src/a.ts"],
      previousComments: [
        {
          chapterIndex: 0,
          path: "src/b.ts",
          side: "new",
          line: 2,
          body: "Why?",
          status: "lines_changed",
        },
      ],
    });
  });
});

test("openRounds: an approval ends the chain, so the next review is round 1", () => {
  withStateDir(() => {
    openRounds("/repo", agent, DIFF).save({ verdict: "request_changes", viewed: ["src/a.ts"] });
    const second = openRounds("/repo", agent, DIFF);
    expect(second.info?.number).toBe(2);
    second.save({ verdict: "approve" });
    expect(openRounds("/repo", agent, DIFF).info).toBeUndefined();
  });
});

test("openRounds: Done with no verdict is an approval — it ends the chain too", () => {
  withStateDir(() => {
    openRounds("/repo", agent, DIFF).save({ verdict: "request_changes", viewed: [] });
    openRounds("/repo", agent, DIFF).save({});
    expect(openRounds("/repo", agent, DIFF).info).toBeUndefined();
  });
});

test("openRounds: one chain per repository, whichever directory the agent ran in", () => {
  withStateDir(() => {
    // A real repo, so `git rev-parse --show-toplevel` has something to answer.
    const repo = mkdtempSync(join(tmpdir(), "rb-repo-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
    git("init", "-q");
    mkdirSync(join(repo, "src", "deep"), { recursive: true });
    try {
      openRounds(repo, agent, DIFF).save({ verdict: "request_changes", viewed: ["src/a.ts"] });
      // The hook passes its own cwd, which can be any directory of the repo.
      const fromSub = openRounds(join(repo, "src", "deep"), agent, DIFF);
      expect(fromSub.info?.number).toBe(2);
      expect(fromSub.info?.viewedPaths).toEqual(["src/a.ts"]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

test("openRounds: a directory that is no repository still gets its own chain", () => {
  withStateDir(() => {
    const plain = mkdtempSync(join(tmpdir(), "rb-plain-"));
    try {
      openRounds(plain, agent, DIFF).save({ verdict: "request_changes", viewed: ["src/a.ts"] });
      expect(openRounds(plain, agent, DIFF).info?.number).toBe(2);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

test("openRounds: another PR of the same repo is its own chain", () => {
  withStateDir(() => {
    openRounds("/repo", agent, DIFF).save({ verdict: "request_changes", viewed: ["src/a.ts"] });
    const pr = { source: { type: "pr", ref: "12" } } as AgentReview;
    expect(openRounds("/repo", pr, DIFF).info).toBeUndefined();
  });
});

test("openRounds: a dismissed finding stays dismissed through the rounds", () => {
  withStateDir(() => {
    openRounds("/repo", agent, DIFF).save({
      verdict: "request_changes",
      findings: [
        { id: "f1", decision: "dismiss", reason: "intentional" },
        { id: "f2", decision: "fix" },
      ],
    });
    openRounds("/repo", agent, DIFF_B_CHANGED).save({
      verdict: "request_changes",
      findings: [{ id: "f3", decision: "dismiss" }],
    });
    // Round 3 reads the store the same way the next review will.
    const store = roundStore("/repo", agent.source);
    expect(store.read()?.round).toBe(2);
    expect(store.read()?.dismissedFindings).toEqual(["f1", "f3"]);
  });
});
