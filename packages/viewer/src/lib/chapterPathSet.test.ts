/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import { chapterPathSet } from "./chapterPathSet.ts";

test("returns the paths matching the chapter prefix", () => {
  expect(chapterPathSet(["1:a.ts", "1:b.ts", "2:c.ts"], 1)).toEqual(new Set(["a.ts", "b.ts"]));
});

test("returns empty for a chapter with no entries", () => {
  expect(chapterPathSet(["2:c.ts"], 1)).toEqual(new Set());
});

test("ignores non-string entries without throwing (corrupted storage)", () => {
  const corrupt = ["1:a.ts", 42, null, { x: 1 }, undefined, "1:b.ts"] as unknown[];
  expect(() => chapterPathSet(corrupt, 1)).not.toThrow();
  expect(chapterPathSet(corrupt, 1)).toEqual(new Set(["a.ts", "b.ts"]));
});
