import { expect, test } from "bun:test";
import { fakeResolvedReview } from "../stories/fixtures.ts";
import { progressByChapter, reviewProgress } from "./progress.ts";

const { chapters } = fakeResolvedReview; // 1, 2 and 1 files in chapters 1, 2, 3

test("per chapter: viewed files and whether all are", () => {
  const entries = ["1:src/example.ts", "2:src/server/auth/session.ts"];
  expect(progressByChapter(chapters, entries)).toEqual([
    { viewedCount: 1, complete: true },
    { viewedCount: 1, complete: false },
    { viewedCount: 0, complete: false },
  ]);
});

test("over the review: a path the chapter does not have, or another chapter's, is not counted", () => {
  expect(reviewProgress(chapters, [])).toEqual({ viewed: 0, total: 4 });
  const entries = ["1:src/example.ts", "1:gone.ts", "3:src/example.ts"];
  expect(reviewProgress(chapters, entries)).toEqual({ viewed: 1, total: 4 });
});
