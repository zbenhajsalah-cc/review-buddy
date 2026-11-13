/**
 * Moved and copied blocks (`ResolvedReview.moves`, found by the tool in the
 * real diff — `core/moves.ts`) as the viewer shows them: a note under the last
 * line of each end, so the reviewer knows the lines above were moved, and
 * whether they are identical.
 */
import type { MoveEnd, ResolvedMove } from "@review-buddy/core/types";
import type { CommentSide } from "./comments.ts";

/** Which end of a move: where the lines were, or where they are now. */
export type MoveSide = "from" | "to";

/** One end of a move, as shown in the file that has it. */
export interface MoveMark {
  move: ResolvedMove;
  side: MoveSide;
}

export const otherSide = (side: MoveSide): MoveSide => (side === "from" ? "to" : "from");

/** The id of a mark's note in the DOM (`data-move-id`). */
export const markId = (mark: MoveMark) => `${mark.move.id}-${mark.side}`;

/** The diff side an end's line numbers count on. */
const diffSide = (side: MoveSide): CommentSide => (side === "from" ? "old" : "new");

/** Where a mark's note goes: under the last line of its end. */
export function markPosition(mark: MoveMark): { side: CommentSide; line: number } {
  const end = mark.move[mark.side];
  return { side: diffSide(mark.side), line: end.start + end.lines - 1 };
}

/** How many moves (not ends) a list of marks is about. */
export const distinctMoves = (marks: readonly MoveMark[]) =>
  new Set(marks.map((m) => m.move.id)).size;

/** The marks a chapter shows, in file and line order. */
export function chapterMoveMarks(
  moves: readonly ResolvedMove[] | undefined,
  chapterIndex: number,
): MoveMark[] {
  const marks: MoveMark[] = [];
  for (const move of moves ?? []) {
    for (const side of ["from", "to"] as const) {
      if (move[side].chapterIndex === chapterIndex) marks.push({ move, side });
    }
  }
  return marks.sort(
    (a, b) =>
      a.move[a.side].path.localeCompare(b.move[b.side].path) ||
      a.move[a.side].start - b.move[b.side].start,
  );
}

/** "line 12", "lines 12–15". */
export function endLines(end: Pick<MoveEnd, "start" | "lines">): string {
  return end.lines === 1 ? `line ${end.start}` : `lines ${end.start}–${end.start + end.lines - 1}`;
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * What a mark says, before the other end's place: "4 lines moved here from",
 * "4 lines moved to", "4 lines copied here from", "4 lines also copied to".
 */
export function markVerb(mark: MoveMark): string {
  const lines = count(mark.move[mark.side].lines, "line");
  if (mark.move.kind === "copied") {
    return mark.side === "to" ? `${lines} copied here from` : `${lines} also copied to`;
  }
  return mark.side === "to" ? `${lines} moved here from` : `${lines} moved to`;
}

/**
 * How alike the two ends are. "identical" is exact. Otherwise the lines match
 * only with the whitespace at their start and end ignored: that is often
 * re-indentation, but it changes a multiline string's value and the structure
 * of Python or YAML, so the reviewer is told to look — never that it is safe.
 */
export const markSameness = (move: ResolvedMove) =>
  move.whitespaceChanged
    ? "not identical: the whitespace at the start or end of lines differs, check it"
    : "identical";

/** "3 moved blocks (120 lines)" for the whole review; "" with none. */
export function movesSummary(moves: readonly ResolvedMove[] | undefined): string {
  if (!moves || moves.length === 0) return "";
  const lines = moves.reduce((n, m) => n + m.to.lines, 0);
  return `${count(moves.length, "moved block")} (${count(lines, "line")})`;
}
