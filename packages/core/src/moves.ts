/**
 * Move detection: blocks of lines that were removed in one place and added in
 * another, unchanged. A plain diff shows a move as a full delete plus a full
 * insert, and the reviewer reads the same code twice.
 *
 * The TOOL finds moves, from the real diff (source B) — never the agent: the
 * reference-not-reproduce rule holds, and a move the agent "saw" would be a
 * claim, not a fact. A move is two line ranges; it carries no code text.
 *
 * How: every run of removed lines and every run of added lines is taken from
 * the hunks. An added run is walked line by line; at each line, the longest
 * block that also exists in a removed run is looked up (lines compared with
 * their leading and trailing whitespace ignored, as moved code is often
 * re-indented). A block counts only when it is big enough to mean something
 * (MIN_LINES / MIN_CHARS): three closing braces are not a move.
 *
 * Ignoring that whitespace finds the block; it does not make the two ends the
 * same. Leading spaces are part of a multiline string's value, and they are
 * the structure of Python or YAML. So a match whose lines are not exactly
 * equal is flagged `whitespaceChanged`, and the viewer says the lines differ
 * — it never says "only the indentation changed", which the tool cannot know.
 *
 * A move with small edits is found as its unchanged parts: the edited lines
 * break the block, and stay ordinary removed/added lines.
 */
import type { ParsedFile } from "./diff.ts";
import { isNoiseFile } from "./noise.ts";

/** Lines with text (blank ones do not count) a block needs. */
export const MIN_LINES = 3;
/** Characters, indentation aside, a block needs. */
export const MIN_CHARS = 40;
/**
 * Places looked at for one added line. A line such as `}` is removed in
 * hundreds of places; the first ones are enough to find the block it is in.
 */
const MAX_CANDIDATES = 200;
/** Above this many changed lines the search is skipped (cost, and noise). */
const MAX_CHANGED_LINES = 100_000;

/** One end of a move: `lines` lines from `start`, in `path`. */
export interface MoveRange {
  /** The file's canonical path (`ParsedFile.path`), also for the removed end. */
  path: string;
  /** First line: an old line number for `from`, a new one for `to`. */
  start: number;
  lines: number;
}

export interface DetectedMove {
  /**
   * "moved": the block left `from`. "copied": the same removed block was
   * already matched by an earlier `to`, so this is one more place it went.
   */
  kind: "moved" | "copied";
  from: MoveRange;
  to: MoveRange;
  /**
   * The lines match only once leading and trailing whitespace is ignored: the
   * ends are NOT identical. Whether that is harmless re-indentation or a real
   * change (a multiline string, Python, YAML) is for the reviewer to judge.
   */
  whitespaceChanged: boolean;
}

interface Line {
  /** Line number on its side. */
  no: number;
  /** The line without its diff sign. */
  raw: string;
  /** `raw` trimmed: what is compared. */
  key: string;
}

interface Run {
  path: string;
  /** The run of -/+ lines it sits in: a block re-indented in place has both its runs in one. */
  group: number;
  lines: Line[];
}

function collectRuns(files: readonly ParsedFile[]): { removed: Run[]; added: Run[] } {
  const removed: Run[] = [];
  const added: Run[] = [];
  let group = 0;
  for (const file of files) {
    if (file.binary || isNoiseFile(file.path)) continue;
    for (const hunk of file.hunks) {
      let oldNo = hunk.oldStart;
      let newNo = hunk.newStart;
      let del: Run | null = null;
      let add: Run | null = null;
      for (const line of hunk.lines) {
        const sign = line[0];
        if (sign === "\\") continue; // "\ No newline at end of file"
        if (sign === "-" || sign === "+") {
          if (!del && !add) group++;
          const raw = line.slice(1);
          const entry = { raw, key: raw.trim() };
          if (sign === "-") {
            if (!del) {
              del = { path: file.path, group, lines: [] };
              removed.push(del);
            }
            del.lines.push({ no: oldNo++, ...entry });
          } else {
            if (!add) {
              add = { path: file.path, group, lines: [] };
              added.push(add);
            }
            add.lines.push({ no: newNo++, ...entry });
          }
        } else {
          del = null;
          add = null;
          oldNo++;
          newNo++;
        }
      }
    }
  }
  return { removed, added };
}

/** Big enough to be worth telling the reviewer about. */
function significant(lines: readonly Line[], from: number, length: number): boolean {
  let withText = 0;
  let chars = 0;
  for (let i = from; i < from + length; i++) {
    const key = lines[i]!.key;
    if (key === "") continue;
    withText++;
    chars += key.length;
  }
  return withText >= MIN_LINES && chars >= MIN_CHARS;
}

/**
 * Find the moved (and copied) blocks of a parsed diff, in the order of their
 * new place. Binary and generated/noise files are left out.
 */
export function detectMoves(files: readonly ParsedFile[]): DetectedMove[] {
  const { removed, added } = collectRuns(files);
  const changed =
    removed.reduce((n, r) => n + r.lines.length, 0) + added.reduce((n, r) => n + r.lines.length, 0);
  if (removed.length === 0 || added.length === 0 || changed > MAX_CHANGED_LINES) return [];

  // Where each removed line's text is: [run, position] pairs. Blank lines are
  // not looked up (a block never starts on one).
  const places = new Map<string, [number, number][]>();
  removed.forEach((run, r) => {
    run.lines.forEach((line, p) => {
      if (line.key === "") return;
      const list = places.get(line.key);
      if (list) list.push([r, p]);
      else places.set(line.key, [[r, p]]);
    });
  });
  // Removed lines some move already took, as "run:position".
  const taken = new Set<string>();
  const isTaken = (r: number, p: number, length: number) => {
    for (let i = 0; i < length; i++) if (taken.has(`${r}:${p + i}`)) return true;
    return false;
  };

  const moves: DetectedMove[] = [];
  for (const run of added) {
    let i = 0;
    while (i < run.lines.length) {
      const candidates = run.lines[i]!.key === "" ? undefined : places.get(run.lines[i]!.key);
      let best: { r: number; p: number; length: number; free: boolean } | null = null;
      for (const [r, p] of candidates?.slice(0, MAX_CANDIDATES) ?? []) {
        const source = removed[r]!;
        // Removed and added again in the same spot: re-indented or edited in
        // place, not moved. The diff already shows it as one change.
        if (source.group === run.group) continue;
        let length = 0;
        while (
          i + length < run.lines.length &&
          p + length < source.lines.length &&
          run.lines[i + length]!.key === source.lines[p + length]!.key
        ) {
          length++;
        }
        // A block does not end on blank lines.
        while (length > 0 && run.lines[i + length - 1]!.key === "") length--;
        if (best && length < best.length) continue;
        const free = !isTaken(r, p, length);
        // Longest first; then a block nothing took yet (a move, not a copy).
        if (!best || length > best.length || (free && !best.free)) best = { r, p, length, free };
      }

      if (!best || !significant(run.lines, i, best.length)) {
        i++;
        continue;
      }
      const source = removed[best.r]!;
      let whitespaceChanged = false;
      for (let k = 0; k < best.length; k++) {
        if (run.lines[i + k]!.raw !== source.lines[best.p + k]!.raw) whitespaceChanged = true;
        taken.add(`${best.r}:${best.p + k}`);
      }
      moves.push({
        kind: best.free ? "moved" : "copied",
        from: { path: source.path, start: source.lines[best.p]!.no, lines: best.length },
        to: { path: run.path, start: run.lines[i]!.no, lines: best.length },
        whitespaceChanged,
      });
      i += best.length;
    }
  }
  return moves;
}
