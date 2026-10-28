import { expect, test } from "bun:test";
import { loadFixtureReview } from "../../main/fixture/index.ts";
import { chapterList, postBody, postedLabel, postProblem } from "./PostReview.tsx";

test("postedLabel names each verdict", () => {
  expect(postedLabel("approve")).toBe("Approved");
  expect(postedLabel("request_changes")).toBe("Changes requested");
  expect(postedLabel("comment")).toBe("Commented");
});

test("chapterList: one line per chapter, titles, risk and size, no diff lines", async () => {
  const { review } = await loadFixtureReview();
  const list = chapterList(review).split("\n");
  expect(list[0]).toBe("**Chapters** (from Review Buddy)");
  expect(list).toHaveLength(review.chapters.length + 2);
  const first = review.chapters[0]!;
  expect(list[2]).toBe(
    `1. **${first.title}** (${first.risk} risk, ${first.fileCount} file${first.fileCount === 1 ? "" : "s"}, +${first.additions} −${first.deletions})`,
  );
  // Nothing of the files' contents.
  const added = review.chapters
    .flatMap((c) => c.files.flatMap((f) => f.hunks.flatMap((h) => h.lines)))
    .filter((line) => line.startsWith("+") && line.trim().length > 8);
  expect(added.length).toBeGreaterThan(0);
  for (const line of added) expect(chapterList(review)).not.toContain(line.slice(1).trim());
});

test("postBody: exactly the summary, then the chapters; nothing else", () => {
  expect(postBody("  Looks good.\n", null)).toBe("Looks good.");
  expect(postBody("", null)).toBe("");
  expect(postBody("", "**Chapters**")).toBe("**Chapters**");
  expect(postBody("Fix the retry.", "**Chapters**")).toBe("Fix the retry.\n\n**Chapters**");
});

test("postProblem: a text where GitHub needs one, own PRs, the size limit", () => {
  expect(postProblem("approve", "", "mona", "octocat")).toBeUndefined();
  expect(postProblem("request_changes", " ", "mona", "octocat")).toBe(
    "Write what should change first.",
  );
  expect(postProblem("comment", "", "mona", "octocat")).toBe("Write a comment first.");
  expect(postProblem("approve", "", "OctoCat", "octocat")).toBe(
    "This is your own PR: GitHub lets you only comment on it.",
  );
  expect(postProblem("comment", "Thanks", "octocat", "octocat")).toBeUndefined();
  expect(postProblem("approve", "x".repeat(65_537), "mona", undefined)).toContain("too long");
});
