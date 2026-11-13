/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import type { ResolvedMove } from "@review-buddy/core/types";
import { chapterMoveMarks, markPosition, markVerb, movesSummary } from "./moves.ts";

const move = (
  id: string,
  fromChapter: number,
  toChapter: number,
  kind = "moved",
): ResolvedMove => ({
  id,
  kind: kind as ResolvedMove["kind"],
  from: { path: "a.ts", start: 10, lines: 4, chapterIndex: fromChapter },
  to: { path: "b.ts", start: 2, lines: 4, chapterIndex: toChapter },
});

test("a chapter shows the ends that are in it", () => {
  const moves = [move("m1", 1, 2), move("m2", 2, 2)];
  expect(chapterMoveMarks(moves, 1).map((m) => `${m.move.id}-${m.side}`)).toEqual(["m1-from"]);
  expect(chapterMoveMarks(moves, 2).map((m) => `${m.move.id}-${m.side}`)).toEqual([
    "m2-from",
    "m1-to",
    "m2-to",
  ]);
  expect(chapterMoveMarks(undefined, 1)).toEqual([]);
});

test("the note goes under the last line of its end, on that end's side", () => {
  const m = move("m1", 1, 2);
  expect(markPosition({ move: m, side: "from" })).toEqual({ side: "old", line: 13 });
  expect(markPosition({ move: m, side: "to" })).toEqual({ side: "new", line: 5 });
});

test("what a mark says", () => {
  expect(markVerb({ move: move("m1", 1, 2), side: "to" })).toBe("4 lines moved here from");
  expect(markVerb({ move: move("m1", 1, 2), side: "from" })).toBe("4 lines moved to");
  expect(markVerb({ move: move("m1", 1, 2, "copied"), side: "to" })).toBe(
    "4 lines copied here from",
  );
  expect(markVerb({ move: move("m1", 1, 2, "copied"), side: "from" })).toBe(
    "4 lines also copied to",
  );
});

test("the summary counts blocks and lines", () => {
  expect(movesSummary(undefined)).toBe("");
  expect(movesSummary([move("m1", 1, 2)])).toBe("1 moved block (4 lines)");
  expect(movesSummary([move("m1", 1, 2), move("m2", 1, 2)])).toBe("2 moved blocks (8 lines)");
});
