/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import type { ResolvedChapter, ResolvedReview } from "../../../types/review.ts";
import { fakeResolvedReview } from "../stories/fixtures.ts";
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

test("untitled review falls back like Overview", () => {
  const review: ResolvedReview = {
    ...fakeResolvedReview,
    pr: { ...fakeResolvedReview.pr, title: "" },
    chapters: [],
  };
  expect(reviewToMarkdown(review).startsWith("# Untitled review\n")).toBe(true);
});
