/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import { parseReview } from "./reviewSchema.ts";

test("parseReview accepts a minimal valid payload", () => {
  const good = {
    meta: { aiGenerated: true, generatedBy: "m", generatedAt: "t", promptVersion: "1" },
    pr: { title: "t", description: "d", author: "a", createdAt: "c", base: "main", head: "feat" },
    prologue: {
      why: "w",
      what: "x",
      key_changes: [{ headline: "h", detail: "d" }],
      review_focus: { summary: "s", file: "f" },
    },
    stats: { additions: 0, deletions: 0, filesChanged: 0 },
    chapters: [],
    warnings: [],
  };
  expect(parseReview(good)).toBeDefined();
});

test("parseReview throws on malformed payload naming the field", () => {
  const bad = {};
  expect(() => parseReview(bad)).toThrow(/Malformed review payload/);
  expect(() => parseReview(bad)).toThrow(/meta/);
});
