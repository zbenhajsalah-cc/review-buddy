/// <reference types="bun-types" />
import { afterEach, expect, test } from "bun:test";
import type { ResolvedHunk } from "@review-buddy/core/types";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReviewApiProvider } from "../review-api.tsx";
import { fakeReviewApi } from "../stories/fixtures.ts";
import { clearReviewFileState } from "./chapterFileSet.ts";
import {
  commentsToMarkdown,
  describeLines,
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

test("rangeFromSelection: across sides, the range ends at its lowest line, dragged either way", () => {
  const deletedToAdded: LineRange = { side: "new", line: 10, startSide: "old", startLine: 9 };
  expect(
    rangeFromSelection({ start: 9, side: "deletions", end: 10, endSide: "additions" }, [CHANGE]),
  ).toEqual(deletedToAdded);
  expect(
    rangeFromSelection({ start: 10, side: "additions", end: 9, endSide: "deletions" }, [CHANGE]),
  ).toEqual(deletedToAdded);

  // A deleted line under an unchanged one: the deleted line is last.
  expect(
    rangeFromSelection({ start: 10, side: "deletions", end: 8, endSide: "additions" }, [CHANGE]),
  ).toEqual({ side: "old", line: 10, startSide: "new", startLine: 8 });
  // The unchanged line after the change is lower than its deleted lines.
  expect(
    rangeFromSelection({ start: 11, side: "additions", end: 9, endSide: "deletions" }, [CHANGE]),
  ).toEqual({ side: "new", line: 11, startSide: "old", startLine: 9 });
});

test("rangeFromSelection: across sides outside the hunks (full-file view)", () => {
  // Two lines added after old line 5: old 5 is new 5, old 6 is new 8.
  const insert: ResolvedHunk = {
    old_start: 5,
    old_lines: 0,
    new_start: 6,
    new_lines: 2,
    header: "@@ -5,0 +6,2 @@",
    lines: ["+x", "+y"],
  };
  expect(
    rangeFromSelection({ start: 6, side: "additions", end: 5, endSide: "deletions" }, [insert]),
  ).toEqual({ side: "new", line: 6, startSide: "old", startLine: 5 });
  expect(
    rangeFromSelection({ start: 6, side: "deletions", end: 7, endSide: "additions" }, [insert]),
  ).toEqual({ side: "old", line: 6, startSide: "new", startLine: 7 });
  // After CHANGE (same size), old and new numbers match again.
  expect(
    rangeFromSelection({ start: 20, side: "deletions", end: 15, endSide: "additions" }, [CHANGE]),
  ).toEqual({ side: "old", line: 20, startSide: "new", startLine: 15 });
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
