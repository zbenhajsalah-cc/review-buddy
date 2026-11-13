import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiff } from "@review-buddy/core/diff";
import { resolveReview } from "@review-buddy/core/resolve";
import { findingIdentities, rememberFindings } from "@review-buddy/core/rounds";
import type { AgentReview, ResolvedFinding, ResolvedReview } from "@review-buddy/core/types";
import { roundStore } from "./round-store.ts";
import { applyRound, openRounds, roundtripEnabled } from "./session.ts";

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

/** An unrelated change in the same repo: no path in common with DIFF. */
const DIFF_OTHER = `diff --git a/docs/c.md b/docs/c.md
index 555..666 100644
--- a/docs/c.md
+++ b/docs/c.md
@@ -1,1 +1,2 @@
 ctx
+other
`;

test("openRounds: a worktree diff that shares no path with the last round starts at round 1", () => {
  withStateDir(() => {
    openRounds("/repo", agent, DIFF).save({ verdict: "request_changes", viewed: ["src/a.ts"] });
    expect(openRounds("/repo", agent, DIFF_OTHER).info).toBeUndefined();
    // …while one that shares a path is still the same change.
    expect(openRounds("/repo", agent, DIFF_B_CHANGED).info?.number).toBe(2);
  });
});

test("openRounds: a PR keeps its chain even when the paths all change", () => {
  withStateDir(() => {
    const pr = { source: { type: "pr", ref: "12" } } as AgentReview;
    openRounds("/repo", pr, DIFF).save({ verdict: "request_changes" });
    expect(openRounds("/repo", pr, DIFF_OTHER).info?.number).toBe(2);
  });
});

test("openRounds: dismissed findings carry to the next round", () => {
  withStateDir(() => {
    const findings: ResolvedFinding[] = [
      { id: "f-1", path: "src/a.ts", title: "A", line: 2, side: "new", severity: "nit" },
      { id: "f-2", path: "src/b.ts", title: "B", line: 2, side: "new", severity: "nit" },
    ];
    openRounds("/repo", agent, DIFF, findings).save({
      verdict: "request_changes",
      findings: [
        { id: "f-1", decision: "dismiss", reason: "not a bug" },
        { id: "f-2", decision: "fix" },
      ],
    });
    const review = { findings } as ResolvedReview;
    applyRound(review, openRounds("/repo", agent, DIFF, findings));
    expect(review.findings?.map((f) => f.id)).toEqual(["f-2"]);
  });
});

test("applyRound: drops dismissed findings and says how many", () => {
  const finding = (id: string) =>
    ({ id, path: "src/a.ts", line: 2, side: "new", severity: "nit", title: id }) as const;
  const review = {
    findings: [finding("f-1"), finding("f-2")],
  } as unknown as ResolvedReview;
  const info = { number: 2, changedPaths: [], viewedPaths: [], previousComments: [] };
  const identities = findingIdentities(review.findings, parseDiff(DIFF));
  const memory = rememberFindings(identities, ["f-1"]);
  applyRound(review, { info, identities, memory });
  expect(review.findings?.map((f) => f.id)).toEqual(["f-2"]);
  expect(review.round).toEqual({ ...info, hiddenFindings: 1 });

  const allGone = { findings: [finding("f-1")] } as unknown as ResolvedReview;
  applyRound(allGone, { info, identities, memory });
  expect(allGone.findings).toBeUndefined();

  const first = { findings: [finding("f-1")] } as unknown as ResolvedReview;
  applyRound(first, { identities, memory });
  expect(first.round).toBeUndefined();
  expect(first.findings).toHaveLength(1);
});

test("real resolved duplicate ids may change without transferring a dismissal", () => {
  withStateDir(() => {
    const reviewAt = (lines: number[], diff = DIFF): ResolvedReview =>
      resolveReview(
        {
          ...agent,
          prologue: {
            why: "why",
            what: "what",
            key_changes: [],
            review_focus: { summary: "look", file: "src/a.ts" },
          },
          chapters: [],
          findings: lines.map((line) => ({
            path: "src/a.ts",
            line,
            title: "Missing error handling",
            severity: "important",
          })),
        },
        diff,
        { aiGenerated: true, generatedBy: "test", generatedAt: "now", promptVersion: "1" },
        {
          title: "t",
          description: "d",
          author: "a",
          createdAt: "now",
          base: "main",
          head: "feature",
        },
      ).review;

    for (const dismissedLine of [1, 2]) {
      roundStore("/repo", agent.source).clear();
      const first = reviewAt([1, 2]);
      const dismissedId = first.findings![dismissedLine - 1]!.id;
      const rounds = openRounds("/repo", agent, DIFF, first.findings);
      applyRound(first, rounds);
      rounds.save({
        verdict: "request_changes",
        findings: [{ id: dismissedId, decision: "dismiss" }],
      });

      // Only the second occurrence remains, and inherits the first one's id.
      const second = reviewAt([2]);
      expect(second.findings![0]!.id).toBe(first.findings![0]!.id);
      const next = openRounds("/repo", agent, DIFF, second.findings);
      applyRound(second, next);
      expect(second.findings?.length ?? 0).toBe(dismissedLine === 2 ? 0 : 1);
      next.save({ verdict: "request_changes" });

      // Its line shifts and the dismissed occurrence returns in round 3.
      const shiftedDiff = DIFF.replace("+added", "+inserted\n+added").replace("+1,3", "+1,4");
      const third = reviewAt([3, 1], shiftedDiff);
      applyRound(third, openRounds("/repo", agent, shiftedDiff, third.findings));
      expect(third.findings?.map((f) => f.line)).toEqual([dismissedLine === 2 ? 1 : 3]);
    }
  });
});
