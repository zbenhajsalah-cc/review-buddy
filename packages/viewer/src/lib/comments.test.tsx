/// <reference types="bun-types" />
import { afterEach, expect, test } from "bun:test";
import { parseDiffFromFile } from "@pierre/diffs";
import type { ResolvedHunk } from "@review-buddy/core/types";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReviewApiProvider } from "../review-api.tsx";
import { fakeReviewApi } from "../stories/fixtures.ts";
import { clearReviewFileState } from "./chapterFileSet.ts";
import {
  chapterDiffSpans,
  commentsToMarkdown,
  describeLines,
  fullDiffSpans,
  type LineComment,
  type LineRange,
  rangeFromSelection,
  readComments,
  useComments,
} from "./comments.ts";

// fakeReviewApi()'s reviewKey is "fake-review".
const KEY = "rb.comments.fake-review";

afterEach(() => {
  cleanup();
  localStorage.removeItem(KEY);
});

const comment = (over: Partial<LineComment> = {}): LineComment => ({
  id: "c1",
  chapterIndex: 1,
  path: "src/a.ts",
  side: "new",
  line: 12,
  body: "Why?",
  ...over,
});

test("rangeFromSelection: one line is just that line", () => {
  expect(rangeFromSelection({ start: 12, end: 12, side: "additions" }, [])).toEqual({
    side: "new",
    line: 12,
  });
  expect(rangeFromSelection({ start: 4, end: 4, side: "deletions" }, [])).toEqual({
    side: "old",
    line: 4,
  });
});

test("rangeFromSelection: a range dragged up still ends at its last line", () => {
  const down = rangeFromSelection({ start: 10, end: 14, side: "additions" }, []);
  const up = rangeFromSelection({ start: 14, end: 10, side: "additions" }, []);
  expect(down).toEqual({ side: "new", line: 14, startSide: "new", startLine: 10 });
  expect(up).toEqual(down);
});

// Unified view of this hunk: old 8 / new 8, old 9, old 10, new 9, new 10, old 11 / new 11.
const CHANGE: ResolvedHunk = {
  old_start: 8,
  old_lines: 4,
  new_start: 8,
  new_lines: 4,
  header: "@@ -8,4 +8,4 @@",
  lines: [" a", "-b", "-c", "+B", "+C", " d"],
};

test("chapterDiffSpans: one span per hunk, with its runs of changed lines", () => {
  expect(chapterDiffSpans([CHANGE])).toEqual([
    {
      oldStart: 8,
      newStart: 8,
      oldEnd: 12,
      blocks: [{ oldFrom: 9, deletions: 2, newFrom: 9, additions: 2 }],
    },
  ]);
  // Only added lines: the hunk names the old line before them.
  const insert: ResolvedHunk = {
    old_start: 5,
    old_lines: 0,
    new_start: 6,
    new_lines: 2,
    header: "@@ -5,0 +6,2 @@",
    lines: ["+x", "+y"],
  };
  expect(chapterDiffSpans([insert])).toEqual([
    {
      oldStart: 6,
      newStart: 6,
      oldEnd: 6,
      blocks: [{ oldFrom: 6, deletions: 0, newFrom: 6, additions: 2 }],
    },
  ]);
});

test("rangeFromSelection: across sides, the range ends at its lowest line, dragged either way", () => {
  const spans = chapterDiffSpans([CHANGE]);
  const deletedToAdded: LineRange = { side: "new", line: 10, startSide: "old", startLine: 9 };
  expect(
    rangeFromSelection({ start: 9, side: "deletions", end: 10, endSide: "additions" }, spans),
  ).toEqual(deletedToAdded);
  expect(
    rangeFromSelection({ start: 10, side: "additions", end: 9, endSide: "deletions" }, spans),
  ).toEqual(deletedToAdded);

  // A deleted line under an unchanged one: the deleted line is last.
  expect(
    rangeFromSelection({ start: 10, side: "deletions", end: 8, endSide: "additions" }, spans),
  ).toEqual({ side: "old", line: 10, startSide: "new", startLine: 8 });
  // The unchanged line after the change is lower than its deleted lines.
  expect(
    rangeFromSelection({ start: 11, side: "additions", end: 9, endSide: "deletions" }, spans),
  ).toEqual({ side: "new", line: 11, startSide: "old", startLine: 9 });
});

test("rangeFromSelection: changes hidden before a hunk shift its unchanged lines", () => {
  // Between these hunks, changes the chapter does not show remove 5 lines:
  // x is old 20 but new 15, so it is above Y (new 16).
  const spans = chapterDiffSpans([
    {
      old_start: 1,
      old_lines: 3,
      new_start: 1,
      new_lines: 3,
      header: "@@ -1,3 +1,3 @@",
      lines: [" a", "-b", "+B", " c"],
    },
    {
      old_start: 20,
      old_lines: 3,
      new_start: 15,
      new_lines: 3,
      header: "@@ -20,3 +15,3 @@",
      lines: [" x", "-y", "+Y", " z"],
    },
  ]);
  // Dragged up from Y to x (its old number, in split view's left column).
  expect(
    rangeFromSelection({ start: 16, side: "additions", end: 20, endSide: "deletions" }, spans),
  ).toEqual({ side: "new", line: 16, startSide: "old", startLine: 20 });
  // c ends the first hunk: it is above x.
  expect(
    rangeFromSelection({ start: 15, side: "additions", end: 3, endSide: "deletions" }, spans),
  ).toEqual({ side: "new", line: 15, startSide: "old", startLine: 3 });
});

// The whole file: other chapters' changes are in this diff too.
const OLD = "a b c d e f g h i j k l".split(" ");
const NEW = "a B c d e f x y g h k l m".split(" ");
const FULL = parseDiffFromFile(
  { name: "f.ts", contents: `${OLD.join("\n")}\n` },
  { name: "f.ts", contents: `${NEW.join("\n")}\n` },
);

test("fullDiffSpans: the whole file as one span, its changes in file line numbers", () => {
  expect(fullDiffSpans(FULL)).toEqual([
    {
      oldStart: 1,
      newStart: 1,
      oldEnd: Number.POSITIVE_INFINITY,
      blocks: [
        { oldFrom: 2, deletions: 1, newFrom: 2, additions: 1 }, // b → B
        { oldFrom: 7, deletions: 0, newFrom: 7, additions: 2 }, // + x y
        { oldFrom: 9, deletions: 2, newFrom: 11, additions: 0 }, // - i j
        { oldFrom: 13, deletions: 0, newFrom: 13, additions: 1 }, // + m
      ],
    },
  ]);
});

test("rangeFromSelection: in the full-file view, the whole file's changes order the range", () => {
  const spans = fullDiffSpans(FULL);
  // Dragged up from k (new 11) to the deleted j (old 10): j is above k.
  expect(
    rangeFromSelection({ start: 11, side: "additions", end: 10, endSide: "deletions" }, spans),
  ).toEqual({ side: "new", line: 11, startSide: "old", startLine: 10 });
  // g (old 7) is new 9, below the added y (new 8).
  expect(
    rangeFromSelection({ start: 7, side: "deletions", end: 8, endSide: "additions" }, spans),
  ).toEqual({ side: "old", line: 7, startSide: "new", startLine: 8 });
});

test("describeLines names the lines and their side", () => {
  expect(describeLines({ side: "new", line: 12 })).toBe("line 12 (new)");
  expect(describeLines({ side: "old", line: 14, startSide: "old", startLine: 10 })).toBe(
    "lines 10-14 (old)",
  );
  expect(describeLines({ side: "new", line: 9, startSide: "old", startLine: 7 })).toBe(
    "lines 7 (old) to 9 (new)",
  );
});

test("commentsToMarkdown: one item per comment, in review order, bodies indented", () => {
  const md = commentsToMarkdown([
    comment({ id: "3", chapterIndex: 2, path: "b.ts", line: 1, body: "Third" }),
    comment({ id: "2", path: "src/a.ts", line: 30, body: "Second\nline two" }),
    comment({ id: "1", path: "src/a.ts", line: 3, body: "  First  " }),
  ]);
  expect(md).toBe(
    [
      "- `src/a.ts` line 3 (new): First",
      "- `src/a.ts` line 30 (new): Second",
      "  line two",
      "- `b.ts` line 1 (new): Third",
    ].join("\n"),
  );
});

test("readComments drops stored entries it cannot show", () => {
  localStorage.setItem(
    KEY,
    JSON.stringify([
      comment(),
      { id: "x", body: "no line" },
      null,
      { ...comment({ id: "c2" }), side: "up" },
    ]),
  );
  expect(readComments("fake-review")).toEqual([comment()]);
});

test("readComments: nothing stored, or not JSON → no comments", () => {
  expect(readComments("fake-review")).toEqual([]);
  localStorage.setItem(KEY, "{oops");
  expect(readComments("fake-review")).toEqual([]);
});

function renderComments() {
  const api = fakeReviewApi();
  return renderHook(() => useComments(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ReviewApiProvider api={api}>{children}</ReviewApiProvider>
    ),
  });
}

test("useComments adds, edits and removes, and stores them per review", () => {
  const { result } = renderComments();
  act(() => {
    result.current.add({ chapterIndex: 1, path: "src/a.ts", side: "new", line: 5, body: "One" });
  });
  act(() => {
    result.current.add({ chapterIndex: 2, path: "src/b.ts", side: "old", line: 2, body: "Two" });
  });
  const [one, two] = result.current.comments;
  expect(one?.body).toBe("One");
  expect(two?.body).toBe("Two");
  expect(one?.id).not.toBe(two?.id);

  act(() => {
    result.current.edit(one?.id ?? "", "One, edited");
  });
  act(() => {
    result.current.remove(two?.id ?? "");
  });
  expect(result.current.comments.map((c) => c.body)).toEqual(["One, edited"]);
  expect(readComments("fake-review")).toEqual(result.current.comments);
});

test("useComments starts from what is stored; submitting clears it", () => {
  localStorage.setItem(KEY, JSON.stringify([comment()]));
  const { result } = renderComments();
  expect(result.current.comments).toEqual([comment()]);
  clearReviewFileState("fake-review");
  expect(localStorage.getItem(KEY)).toBeNull();
});
