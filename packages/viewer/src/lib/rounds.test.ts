/// <reference types="bun-types" />
import { afterEach, expect, test } from "bun:test";
import type { ResolvedChapter, ResolvedReview } from "@review-buddy/core/types";
import { fakeResolvedReview, fakeReviewRoundTwo } from "../stories/fixtures.ts";
import { fullyViewedPaths, seedViewedFromRound } from "./rounds.ts";

const VIEWED_KEY = "rb.viewed.r2";

afterEach(() => localStorage.removeItem(VIEWED_KEY));

const chapter = (index: number, paths: string[]): ResolvedChapter => ({
  index,
  title: `Chapter ${index}`,
  risk: "Low",
  risk_reason: "",
  additions: 0,
  deletions: 0,
  fileCount: paths.length,
  description: "",
  files: paths.map((path) => ({
    path,
    change_type: "modified",
    additions: 1,
    deletions: 0,
    language: "typescript",
    hunks: [],
  })),
});

test("fullyViewedPaths: a file counts only when every chapter that showed it is marked", () => {
  // src/both.ts is in chapters 1 and 2; src/one.ts only in chapter 1.
  const chapters = [chapter(1, ["src/both.ts", "src/one.ts"]), chapter(2, ["src/both.ts"])];
  expect(fullyViewedPaths(chapters, ["1:src/both.ts", "1:src/one.ts"])).toEqual(["src/one.ts"]);
  expect(fullyViewedPaths(chapters, ["1:src/both.ts", "2:src/both.ts"])).toEqual(["src/both.ts"]);
  expect(fullyViewedPaths(chapters, [])).toEqual([]);
});

test("fullyViewedPaths: a stale entry for a path no longer in the diff is ignored", () => {
  expect(fullyViewedPaths([chapter(1, ["src/a.ts"])], ["1:src/a.ts", "1:src/gone.ts"])).toEqual([
    "src/a.ts",
  ]);
});

test("seedViewedFromRound: the carried-over paths are marked in every chapter that shows them", () => {
  const marked = seedViewedFromRound(fakeReviewRoundTwo, "r2");
  expect(marked.sort()).toEqual([
    "src/example.ts",
    "src/jobs/backoff.ts",
    "src/server/auth/session.ts",
  ]);
  const entries = JSON.parse(localStorage.getItem(VIEWED_KEY) ?? "[]") as string[];
  expect(entries).toContain("1:src/example.ts");
  expect(entries).toContain("2:src/server/auth/session.ts");
  expect(entries).toContain("3:src/jobs/backoff.ts");
  // The file the agent changed is not marked: it is new work.
  expect(entries.some((e) => e.endsWith("src/server/auth/middleware.ts"))).toBe(false);
  // And the viewer reads it back as viewed over the whole review.
  expect(fullyViewedPaths(fakeReviewRoundTwo.chapters, entries).sort()).toEqual(marked.sort());
});

test("seedViewedFromRound: a first round seeds nothing", () => {
  expect(seedViewedFromRound(fakeResolvedReview, "r2")).toEqual([]);
  expect(localStorage.getItem(VIEWED_KEY)).toBeNull();
});

test("seedViewedFromRound: a path the new chapters do not have is simply dropped", () => {
  const review: ResolvedReview = {
    ...fakeResolvedReview,
    round: { number: 2, changedPaths: [], viewedPaths: ["src/vanished.ts"], previousComments: [] },
  };
  expect(seedViewedFromRound(review, "r2")).toEqual([]);
  expect(localStorage.getItem(VIEWED_KEY)).toBeNull();
});

test("seedViewedFromRound: it only seeds — a reload never overwrites the reviewer's own marks", () => {
  localStorage.setItem(VIEWED_KEY, JSON.stringify(["1:src/example.ts"]));
  expect(seedViewedFromRound(fakeReviewRoundTwo, "r2")).toEqual([]);
  expect(JSON.parse(localStorage.getItem(VIEWED_KEY) ?? "[]")).toEqual(["1:src/example.ts"]);
});

test("seedViewedFromRound: an emptied list is the reviewer's too, and stands", () => {
  // They unmarked everything, then reloaded: nothing is marked again for them.
  localStorage.setItem(VIEWED_KEY, "[]");
  expect(seedViewedFromRound(fakeReviewRoundTwo, "r2")).toEqual([]);
  expect(localStorage.getItem(VIEWED_KEY)).toBe("[]");
});
