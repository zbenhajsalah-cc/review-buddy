import { expect, test } from "bun:test";
import type { ResolvedFinding } from "@review-buddy/core/types";
import {
  chapterFindings,
  findingCounts,
  findingLines,
  findingToMarkdown,
  otherFindings,
  sortFindings,
} from "./findings.ts";

const f = (over: Partial<ResolvedFinding>): ResolvedFinding => ({
  id: over.title ?? "x",
  path: "a.ts",
  line: 1,
  side: "new",
  severity: "nit",
  title: "t",
  ...over,
});

test("counts: only the severities present, with plurals", () => {
  expect(
    findingCounts([
      f({ severity: "important" }),
      f({ severity: "important" }),
      f({ severity: "important" }),
      f({ severity: "nit" }),
      f({ severity: "nit" }),
      f({ severity: "pre_existing" }),
    ]),
  ).toBe("3 important · 2 nits · 1 pre-existing");
  expect(findingCounts([f({ severity: "nit" })])).toBe("1 nit");
  expect(findingCounts([])).toBe("");
});

test("sorted by severity, then path and line", () => {
  const sorted = sortFindings([
    f({ title: "nit b", path: "b.ts" }),
    f({ title: "pre", severity: "pre_existing" }),
    f({ title: "imp 9", severity: "important", line: 9 }),
    f({ title: "imp 2", severity: "important", line: 2 }),
    f({ title: "nit a", path: "a.ts" }),
  ]);
  expect(sorted.map((x) => x.title)).toEqual(["imp 2", "imp 9", "nit a", "nit b", "pre"]);
});

test("lines: one line or a range, with the side", () => {
  expect(findingLines(f({ line: 42 }))).toBe("line 42 (new)");
  expect(findingLines(f({ line: 42, start_line: 40, side: "old" }))).toBe("lines 40-42 (old)");
});

test("chapter and other findings split by chapterIndex", () => {
  const all = [f({ title: "in 1", chapterIndex: 1 }), f({ title: "none" })];
  expect(chapterFindings(all, 1).map((x) => x.title)).toEqual(["in 1"]);
  expect(chapterFindings(undefined, 1)).toEqual([]);
  expect(otherFindings(all).map((x) => x.title)).toEqual(["none"]);
});

test("Markdown: location, severity, title, notes, and an indented body", () => {
  expect(
    findingToMarkdown(
      f({
        severity: "important",
        path: "src/a.ts",
        line: 7,
        title: "Off by one",
        source: "/code-review",
        outsideDiff: true,
        body: "First.\nSecond.",
      }),
    ),
  ).toBe(
    "- **Important** `src/a.ts` line 7 (new): Off by one (outside the diff, from /code-review)\n  First.\n  Second.",
  );
  expect(findingToMarkdown(f({ title: "Plain" }))).toBe("- **Nit** `a.ts` line 1 (new): Plain");
});
