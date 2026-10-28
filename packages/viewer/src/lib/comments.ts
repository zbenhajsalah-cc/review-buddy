/**
 * Line comments: the reviewer's notes on diff lines. Like viewed state, they
 * are kept in this browser per review (`ReviewApi.reviewKey`) and cleared when
 * the review is submitted. For now they leave the viewer only through "copy as
 * Markdown"; sending them to the agent with the verdict is the round-trip's
 * next step (docs/DESIGN-roundtrip.md §2).
 *
 * A comment points at real diff lines (side + line number), never at their
 * text: the reference-not-reproduce rule holds for comments too.
 */
import type { AnnotationSide, SelectedLineRange } from "@pierre/diffs";
import type { ResolvedHunk } from "@review-buddy/core/types";
import { useCallback, useMemo } from "react";
import { useReviewApi } from "../review-api.tsx";
import { reviewStorageKey } from "./chapterFileSet.ts";
import { parseStored, usePersistedState } from "./usePersistedState.ts";

/** Which side of the diff a line number counts on. */
export type CommentSide = "old" | "new";

/**
 * The lines a comment is about. `side` + `line` is its last line, where the
 * comment shows; `startSide` + `startLine` its first, only when it covers
 * more than one line.
 */
export interface LineRange {
  side: CommentSide;
  line: number;
  startSide?: CommentSide;
  startLine?: number;
}

export interface LineComment extends LineRange {
  id: string;
  /** The chapter's stable `index`: a file can be in two chapters. */
  chapterIndex: number;
  path: string;
  /** Markdown. */
  body: string;
}

export type NewLineComment = Omit<LineComment, "id">;

const fromAnnotationSide = (side: AnnotationSide | undefined): CommentSide =>
  side === "deletions" ? "old" : "new";

export const toAnnotationSide = (side: CommentSide): AnnotationSide =>
  side === "old" ? "deletions" : "additions";

/** One key per place a comment can show: its last line. */
export const positionKey = (r: LineRange) => `${r.side}:${r.line}`;

/**
 * A line selection from @pierre/diffs (dragged either way) as a LineRange,
 * ending at the range's lowest line in the diff of `hunks` (the file's).
 */
export function rangeFromSelection(
  selection: SelectedLineRange,
  hunks: readonly ResolvedHunk[],
): LineRange {
  const a = { side: fromAnnotationSide(selection.side), line: selection.start };
  const b = {
    side: fromAnnotationSide(selection.endSide ?? selection.side),
    line: selection.end,
  };
  // On one side, the bigger number is lower in the diff. Across sides, the
  // hunks tell where the old line is.
  const aFirst =
    a.side === b.side
      ? a.line <= b.line
      : a.side === "old"
        ? oldLineFirst(hunks, a.line, b.line)
        : !oldLineFirst(hunks, b.line, a.line);
  const [first, last] = aFirst ? [a, b] : [b, a];
  if (first.side === last.side && first.line === last.line) return last;
  return { ...last, startSide: first.side, startLine: first.line };
}

/**
 * Whether old line `oldLine` comes before new line `newLine` in the unified
 * diff: a deleted line sits just before the new line that follows it (a
 * change shows its deleted lines first), an unchanged line on the row of its
 * new number.
 */
function oldLineFirst(hunks: readonly ResolvedHunk[], oldLine: number, newLine: number): boolean {
  let shift = 0; // new number − old number of the unchanged lines so far
  for (const hunk of hunks) {
    // A side with no lines in the hunk names the line before it.
    let oldNo = hunk.old_lines === 0 ? hunk.old_start + 1 : hunk.old_start;
    let newNo = hunk.new_lines === 0 ? hunk.new_start + 1 : hunk.new_start;
    if (oldLine < oldNo) break;
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        newNo++;
      } else if (line.startsWith("-")) {
        if (oldNo === oldLine) return newNo <= newLine;
        oldNo++;
      } else if (line.startsWith(" ")) {
        if (oldNo === oldLine) return newNo < newLine;
        oldNo++;
        newNo++;
      }
    }
    shift = newNo - oldNo;
  }
  return oldLine + shift < newLine;
}

/** "line 12 (new)", "lines 10-14 (new)", "lines 10 (old) to 14 (new)". */
export function describeLines(r: LineRange): string {
  if (r.startLine === undefined) return `line ${r.line} (${r.side})`;
  const startSide = r.startSide ?? r.side;
  if (startSide === r.side) return `lines ${r.startLine}-${r.line} (${r.side})`;
  return `lines ${r.startLine} (${startSide}) to ${r.line} (${r.side})`;
}

/** Review order: chapter, then file, then line. */
export function sortComments(comments: readonly LineComment[]): LineComment[] {
  return [...comments].sort(
    (a, b) =>
      a.chapterIndex - b.chapterIndex ||
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.side.localeCompare(b.side),
  );
}

/** A Markdown list item per comment: "- `path` line 12 (new): body". */
export function commentsToMarkdown(comments: readonly LineComment[]): string {
  return sortComments(comments)
    .map((c) => `- \`${c.path}\` ${describeLines(c)}: ${c.body.trim().replace(/\n/g, "\n  ")}`)
    .join("\n");
}

const isSide = (v: unknown): v is CommentSide => v === "old" || v === "new";

/** Storage is the reviewer's browser: drop entries this version can't show. */
function isComment(v: unknown): v is LineComment {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.chapterIndex === "number" &&
    typeof c.path === "string" &&
    typeof c.body === "string" &&
    isSide(c.side) &&
    typeof c.line === "number" &&
    (c.startLine === undefined || typeof c.startLine === "number") &&
    (c.startSide === undefined || isSide(c.startSide))
  );
}

const commentsKey = (reviewKey: string) => reviewStorageKey("comments", reviewKey);

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** This review's comments, read once (the overview, the Done check). */
export function readComments(reviewKey: string): LineComment[] {
  try {
    return parseStored<unknown[]>(localStorage.getItem(commentsKey(reviewKey)), []).filter(
      isComment,
    );
  } catch {
    return [];
  }
}

/** This review's comments, with stable add / edit / remove callbacks. */
export function useComments() {
  const [stored, setStored] = usePersistedState<unknown[]>(
    commentsKey(useReviewApi().reviewKey),
    [],
    "local",
  );
  const comments = useMemo(() => stored.filter(isComment), [stored]);
  const add = useCallback(
    (comment: NewLineComment) => setStored((prev) => [...prev, { ...comment, id: newId() }]),
    [setStored],
  );
  const edit = useCallback(
    (id: string, body: string) =>
      setStored((prev) => prev.map((c) => (isComment(c) && c.id === id ? { ...c, body } : c))),
    [setStored],
  );
  const remove = useCallback(
    (id: string) => setStored((prev) => prev.filter((c) => !(isComment(c) && c.id === id))),
    [setStored],
  );
  return { comments, add, edit, remove };
}
