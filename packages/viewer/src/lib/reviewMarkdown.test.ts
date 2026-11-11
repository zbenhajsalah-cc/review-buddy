/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import type { ResolvedChapter, ResolvedReview } from "@review-buddy/core/types";
import {
  fakeResolvedReview,
  fakeReviewWithEvidence,
  fakeReviewWithFindings,
  fakeReviewWithQuestions,
} from "../stories/fixtures.ts";
import type { LineComment } from "./comments.ts";
import { chapterToMarkdown, reviewToMarkdown } from "./reviewMarkdown.ts";

const DIFF_MARKER = "UNIQUE_DIFF_LINE_MARKER_9f3a";

function chapterWithRenameAndBinary(): ResolvedChapter {
  return {
    index: 2,
    title: "Move assets",
    risk: "Medium",
    risk_reason: "Touches packaging paths.",
    additions: 5,
    deletions: 3,
    fileCount: 2,
    description: "Renames a module and adds a binary asset.",
    files: [
      {
        path: "src/new-name.ts",
        old_path: "src/old-name.ts",
        change_type: "renamed",
        additions: 5,
        deletions: 3,
        language: "typescript",
        hunks: [
          {
            old_start: 1,
            old_lines: 1,
            new_start: 1,
            new_lines: 1,
            header: "@@ -1,1 +1,1 @@",
            lines: [`-${DIFF_MARKER}`, `+${DIFF_MARKER}_new`],
          },
        ],
      },
      {
        path: "assets/logo.png",
        change_type: "added",
        additions: 0,
        deletions: 0,
        language: "png",
        binary: true,
        hunks: [],
      },
    ],
  };
}

test("chapter with rename and binary file renders both correctly", () => {
  const md = chapterToMarkdown(chapterWithRenameAndBinary());

  expect(md).toContain("## 02 Move assets");
  expect(md).toContain("Medium — Touches packaging paths. · +5/-3 · 2 files");
  expect(md).toContain("Renames a module and adds a binary asset.");
  expect(md).toContain("- src/old-name.ts → src/new-name.ts (renamed) +5/-3");
  expect(md).toContain("- assets/logo.png (added, binary) +0/-0");
});

test("full review renders prologue, every chapter heading, and warnings", () => {
  const review: ResolvedReview = {
    ...fakeResolvedReview,
    warnings: ["Unmatched anchor in src/example.ts", "File not in diff: gone.ts"],
  };
  const md = reviewToMarkdown(review);

  expect(md.startsWith("# Add greeting suffix\n")).toBe(true);
  expect(md).toContain("dev@example.com · main ← feature/greeting · +12/-4 · 3 files");
  expect(md).toContain("## Prologue");
  expect(md).toContain("**Why**");
  expect(md).toContain("Users wanted a warmer greeting.");
  expect(md).toContain("**What**");
  expect(md).toContain("Append a suffix to the default greeting string.");
  expect(md).toContain("**Key changes**");
  expect(md).toContain("- **Greeting text** — Changed return value in `greet()`.");
  expect(md).toContain("- **Tests** — Updated snapshot expectations.");
  expect(md).toContain("**Review focus**");
  expect(md).toContain("Confirm the new string matches product copy. `src/example.ts`");
  expect(md).toContain("## Chapters");
  expect(md).toContain("### 01 Update greeting copy");
  expect(md).toContain("### 02 Refactor auth middleware");
  expect(md).toContain("### 03 Adjust retry backoff");
  expect(md).toContain("## Resolution notes");
  expect(md).toContain("- Unmatched anchor in src/example.ts");
  expect(md).toContain("- File not in diff: gone.ts");
});

test("review with no warnings emits no Resolution notes heading", () => {
  const md = reviewToMarkdown(fakeResolvedReview);
  expect(md).not.toContain("## Resolution notes");
});

test("output contains no diff line content", () => {
  const chapter = chapterWithRenameAndBinary();
  const review: ResolvedReview = {
    ...fakeResolvedReview,
    chapters: [chapter],
    warnings: [],
  };

  expect(chapterToMarkdown(chapter)).not.toContain(DIFF_MARKER);
  expect(reviewToMarkdown(review)).not.toContain(DIFF_MARKER);
});

test("empty key_changes and empty chapters omit those sections", () => {
  const review: ResolvedReview = {
    ...fakeResolvedReview,
    prologue: {
      ...fakeResolvedReview.prologue,
      key_changes: [],
    },
    chapters: [],
    warnings: [],
  };
  const md = reviewToMarkdown(review);

  expect(md).not.toContain("**Key changes**");
  expect(md).not.toContain("## Chapters");
  expect(md).toContain("## Prologue");
  expect(md).toContain("**Review focus**");
});

test("open questions appear in the copy, and nothing without them", () => {
  const md = reviewToMarkdown(fakeReviewWithQuestions);
  expect(md).toContain("**Before you read the code**");
  expect(md).toContain(
    "- The task was a greeting change. Should the auth refactor be its own PR? — Chapter 2 rewires",
  );
  expect(md).toContain(
    "- Is a fixed backoff still right, now that `docs/QUEUE.md` asks for jitter?\n",
  );
  expect(md.indexOf("**Before you read the code**")).toBeLessThan(md.indexOf("## Chapters"));

  expect(reviewToMarkdown(fakeResolvedReview)).not.toContain("Before you read the code");
});

test("evidence appears in the copy (names and states only), and nothing without it", () => {
  const md = reviewToMarkdown(fakeReviewWithEvidence);
  expect(md).toContain(
    [
      "## Evidence",
      "",
      "**CI (GitHub)**: 1 failed, 1 pending, 12 passed",
      "",
      "- CI / test (windows) — failed",
      "- CI / e2e — pending",
      "",
      "**Reported by the agent**",
      "",
      "- `pnpm test:viewer` — failed (1 snapshot differs)",
      "- `pnpm test:core` — passed (214 tests passed)",
      "- `pnpm typecheck` — passed",
      "- `pnpm smoke:plugin` — not run",
      "",
      "**Not covered:** The Windows path handling was not run on Windows.",
    ].join("\n"),
  );
  expect(md.indexOf("## Evidence")).toBeLessThan(md.indexOf("## Chapters"));
  expect(reviewToMarkdown(fakeResolvedReview)).not.toContain("## Evidence");
});

test("untitled review falls back like Overview", () => {
  const review: ResolvedReview = {
    ...fakeResolvedReview,
    pr: { ...fakeResolvedReview.pr, title: "" },
    chapters: [],
  };
  expect(reviewToMarkdown(review).startsWith("# Untitled review\n")).toBe(true);
});

const note = (chapterIndex: number, path: string, line: number, body: string): LineComment => ({
  id: `${chapterIndex}-${line}`,
  chapterIndex,
  path,
  side: "new",
  line,
  body,
});

test("a chapter's comments come after its files; none, no heading", () => {
  const chapter = chapterWithRenameAndBinary();
  const md = chapterToMarkdown(chapter, 2, [note(2, "src/new-name.ts", 3, "Keep the old export?")]);
  expect(
    md.endsWith("**Comments**\n\n- `src/new-name.ts` line 3 (new): Keep the old export?"),
  ).toBe(true);
  expect(chapterToMarkdown(chapter)).not.toContain("**Comments**");
});

test("the full review puts each comment under its own chapter", () => {
  const md = reviewToMarkdown(fakeResolvedReview, [
    note(3, "src/retry.ts", 8, "Cap the backoff."),
    note(1, "src/example.ts", 11, "Is the comma on purpose?"),
  ]);
  const ch1 = md.indexOf("### 01");
  const ch2 = md.indexOf("### 02");
  const ch3 = md.indexOf("### 03");
  const first = md.indexOf("Is the comma on purpose?");
  const second = md.indexOf("Cap the backoff.");
  expect(ch1 < first && first < ch2).toBe(true);
  expect(ch3 < second).toBe(true);
  expect(md.match(/\*\*Comments\*\*/g)?.length).toBe(2);
});

test("incomplete CI is said in the copy", () => {
  const review = {
    ...fakeReviewWithEvidence,
    pr: { ...fakeReviewWithEvidence.pr, checksIncomplete: true },
  };
  expect(reviewToMarkdown(review)).toContain(
    "Some checks could not be read, so this list may miss failures.",
  );
  expect(reviewToMarkdown(fakeReviewWithEvidence)).not.toContain("could not be read");
});

test("findings: the reviewer's answers are copied with them", () => {
  const md = reviewToMarkdown(
    fakeReviewWithFindings,
    [],
    [
      { id: "f-0000aaaa", decision: "fix" },
      { id: "f-0000dddd", decision: "dismiss", reason: "tracked elsewhere" },
    ],
  );
  expect(md).toContain(
    "An expired token is accepted when the clock skew is negative (from /code-review)",
  );
  expect(md).toContain("→ To fix");
  expect(md).toContain("→ Dismissed: tracked elsewhere");
  // A finding with no answer is copied without one.
  expect(md).toContain("Name the 30-minute constant");
  expect(md.match(/→/g)).toHaveLength(2);
});

test("findings: under their chapter, and the others in their own section", () => {
  const md = reviewToMarkdown(fakeReviewWithFindings);
  const ch2 = md.indexOf("### 02 Refactor auth middleware");
  const ch3 = md.indexOf("### 03 Adjust retry backoff");
  const findings = md.indexOf("**Findings**");
  expect(findings).toBeGreaterThan(ch2);
  expect(findings).toBeLessThan(ch3);
  expect(md).toContain(
    "- **Important** `src/server/auth/session.ts` line 120 (new): The session cache is never cleared on logout (outside the diff)",
  );
  expect(md).toContain(
    "## Other findings\n\n- **Pre-existing** `src/legacy/cookies.ts` line 14 (new): Cookies are set without SameSite (from /security-review)",
  );
  expect(reviewToMarkdown(fakeResolvedReview)).not.toContain("Findings");
});
