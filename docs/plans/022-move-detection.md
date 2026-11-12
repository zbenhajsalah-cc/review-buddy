# Plan 022: Moved code — shown as a move, not as a delete plus an insert

**Status:** built (first version). **Size:** medium.

## Why

A diff shows moved code as a full delete in one place and a full insert in
another. The reviewer reads the same code twice, and cannot tell at a glance
that nothing in it changed. A refactor that moves 200 lines and edits 5 looks
like 400 changed lines.

Git only knows whole-file renames (`changeType: "renamed"`). A block moved
inside a file or between files looks like two unrelated changes.

This fits the rule in [`README.md`](./README.md): it is about the **human's
attention** (what not to re-read), not about correctness.

## What the reviewer gets

- Under the last line of a moved block, a small note:
  "↑ 31 lines moved here from `src/cart.ts` (lines 10–40) — identical", with a
  link **Show where it was**. The removed side has the mirror note ("moved to
  …", **Show where it is now**).
- The note says **identical** or **only the indentation differs**.
- The link jumps to the other end: in the same chapter it scrolls there; in
  another chapter it opens that chapter at the file.
- The file header has a **moved code** badge. The chapter sidebar lists the
  chapter's moved blocks (a click scrolls to one). The Overview has one line:
  "3 moved blocks (120 lines)".
- With no moves, nothing is shown.

## Design

### Who detects it

The **tool**, from the real diff (source B). Never the agent: the
reference-not-reproduce rule holds, and a move the agent "saw" would be a
claim, not a fact. Nothing is added to `submit_review`, to the skill, or to
the prompts. Every harness and the desktop app get it for free, because it
runs inside `resolveReview`.

### Detection (`packages/core/src/moves.ts`, runtime-neutral)

`detectMoves(parsedFiles)`:

1. Collect every run of removed lines and every run of added lines from the
   hunks. Binary files and noise files (lockfiles, …) are left out.
2. Walk each added run line by line. At each line, look up the longest block
   that also exists in a removed run. Lines are compared **trimmed**, because
   moved code is often re-indented.
3. Keep a block only when it is big enough: at least **3 lines with text** and
   **40 characters** (indentation aside). Three closing braces are not a move.
4. A block removed and added again in the **same spot** (same run of -/+
   lines) is not a move: it was re-indented or edited in place, and the diff
   already shows that as one change.
5. The first added block that matches a removed block is `moved`. If the same
   removed lines match again elsewhere, that one is `copied`.

This is our own matching, like git's `--color-moved`. We do not ask git: the
plugin's PR mode reads the diff from `gh pr diff` and the desktop app from the
GitHub API, where no git option can be passed.

Limits that keep it cheap: at most 200 candidate places per line, and no
search at all above 100,000 changed lines.

### Resolution (`packages/core/src/resolve.ts`)

After the chapters are built, each end of a move gets its `chapterIndex`: the
chapter whose hunk shows the end's first line. Every hunk is in exactly one
chapter, so both ends always have one.

```ts
ResolvedReview.moves?: {
  id: string;                 // "m1", "m2", …
  kind: "moved" | "copied";
  from: { path; start; lines; chapterIndex };  // old line numbers
  to:   { path; start; lines; chapterIndex };  // new line numbers
  reindented?: true;          // only indentation / trailing spaces differ
}[]
```

Line ranges only — no code text.

### Viewer

- `lib/moves.ts`: which ends a chapter shows, where a note goes, its words.
- `components/MoveNote.tsx`: the note. It is a line annotation of
  `@pierre/diffs`, like comments and findings (the library has no "moved line"
  style of its own).
- `FileDiffCard.tsx`: notes under the lines, the badge.
- `ChapterReview.tsx`: the sidebar list, and the jump to the other end
  (`onNavigate(position, file)` for another chapter).
- `Overview.tsx`: the one-line count.

## Decisions on the open points of the backlog entry

- **How to detect:** our own matching of removed and added line runs (above).
- **Two halves in different chapters:** each chapter shows its own end; the
  note links to the other chapter.
- **A move with small edits:** the edited lines break the block. Each unchanged
  part that is big enough is marked; the edited lines stay normal -/+ lines, so
  the reviewer's eye goes to them.
- **Can `@pierre/diffs` render it:** not as a line style. A note under the
  block (an annotation) works in unified and split layout, and in the
  full-file view.

## Not in this version

- **Dimming the moved lines** or folding them away. The note says what they
  are; hiding lines is a bigger step (see plan 021, "skim").
- **Copies of code that was not removed.** The source of such a copy is not in
  the diff, so it needs the file contents (source C). Only "the same removed
  block went to two places" is called a copy today.
- **Whole-file copies** (git's `-C`): the capture does not ask git for them,
  and the PR diff from GitHub never has them.
- **Moved lines in the stats** ("+120 −120, of which 100 moved").
- **The copied Markdown** and the **agent-facing text** do not mention moves.
- A setting to turn it off, or to change the thresholds.

## Tests

- `core/moves.test.ts`: between files, inside a file with new indentation,
  re-indented in place (not a move), too small, split by an edit, move then
  copy, blank lines, noise files, renamed file.
- `core/resolve.test.ts`: chapters of both ends, an end in "Unsorted changes",
  field absent with no moves.
- Viewer: `lib/moves.test.ts`, the note and badge in `FileDiffCard.test.tsx`,
  the sidebar list and both kinds of jump in `ChapterReview.moves.test.tsx`,
  the Overview line.
- Checked in the browser with the built plugin on a real repo: one block moved
  between files (two chapters) and one moved inside a file.
