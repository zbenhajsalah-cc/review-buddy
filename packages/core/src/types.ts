/**
 * Review Buddy type contracts.
 *
 * Two shapes — keep them distinct:
 *  - Agent contract  (submit_review input): narrative + grouping + hunk anchors.
 *  - UI/server contract (GET /api/review):  agent JSON merged with the real diff,
 *                                           PR metadata, server meta, computed stats.
 *
 * See docs/review-contract.md and ../schemas/review.schema.json.
 */

export type Risk = "Low" | "Medium" | "High";
export type ChangeType = "added" | "modified" | "deleted" | "renamed";

/* ------------------------------------------------------------------ */
/* Shared narrative shapes (identical across both contracts)           */
/* ------------------------------------------------------------------ */

export interface KeyChange {
  headline: string;
  detail: string;
}

export interface ReviewFocus {
  /** Concrete check, phrased for a reviewer who hasn't seen the code. */
  summary: string;
  /** The single file to scrutinize most. */
  file: string;
}

/** A scope or direction question, shown before the reviewer reads the code. */
export interface OpenQuestion {
  /** One sentence, Markdown. */
  question: string;
  /** Why the agent asks, with a file or doc name as evidence. */
  context?: string;
}

export interface Prologue {
  why: string;
  what: string;
  key_changes: KeyChange[];
  review_focus: ReviewFocus;
  /** At most 3. Omitted (or empty) when the agent has none — most reviews. */
  open_questions?: OpenQuestion[];
}

/* ------------------------------------------------------------------ */
/* 1. AGENT CONTRACT — submit_review input                             */
/* ------------------------------------------------------------------ */

/** Anchor only — references a hunk by its @@ header start lines. No content. */
export interface HunkAnchor {
  old_start: number;
  new_start: number;
}

export interface AgentReviewFile {
  path: string;
  change_type: ChangeType;
  /** Omit ⇒ the whole file belongs to this chapter. */
  hunks?: HunkAnchor[];
}

export interface AgentChapter {
  index: number;
  title: string;
  risk: Risk;
  risk_reason: string;
  /** Advisory; the tool recomputes authoritative stats from the real diff. */
  additions?: number;
  deletions?: number;
  description: string;
  files: AgentReviewFile[];
}

/**
 * What the agent reviewed, so the hook can re-capture the SAME authoritative
 * diff (the hook never sees `/review`'s arguments — only this payload + cwd):
 *  - worktree: uncommitted changes vs HEAD (the default).
 *  - pr:       a GitHub PR — the hook runs `gh pr diff <ref>`.
 *  - branch:   changes vs a base ref — the hook runs `git diff <ref>`.
 * Omit ⇒ worktree (back-compat).
 */
export type ReviewSourceType = "worktree" | "pr" | "branch";
export interface ReviewSource {
  type: ReviewSourceType;
  /** PR number/URL for `pr`; base ref for `branch`. Unused for `worktree`. */
  ref?: string;
}

/**
 * One check the agent ran in its session (or skipped). Reported by the
 * agent, so the viewer labels it as such: it is not proof.
 */
export type VerificationStatus = "passed" | "failed" | "not_run";
export interface VerificationCheck {
  /** The command, e.g. `pnpm test:core`. */
  command: string;
  status: VerificationStatus;
  /** One short line, e.g. "214 tests passed". Never pasted output. */
  summary?: string;
}

/** What the agent checked, and what those checks would miss. */
export interface Verification {
  checks?: VerificationCheck[];
  /** Markdown. */
  not_covered?: string;
}

/**
 * A finding from another tool (`/code-review`, `/security-review`, a CI
 * reviewer). Review Buddy does not look for bugs: it shows these on their
 * line. Path and line only — never code text.
 */
export type FindingSeverity = "important" | "nit" | "pre_existing";
export interface AgentFinding {
  path: string;
  /** The finding's (last) line, on `side`. */
  line: number;
  /** The first line, for a range. */
  start_line?: number;
  /** Omit ⇒ "new". */
  side?: CommentSide;
  severity: FindingSeverity;
  /** One line. */
  title: string;
  /** Markdown, at most 1,000 characters. */
  body?: string;
  /** The tool that found it. */
  source?: string;
}

/** Exactly what the agent emits via submit_review. */
export interface AgentReview {
  prologue: Prologue;
  chapters: AgentChapter[];
  /** How to capture the diff (see ReviewSource). Omit ⇒ worktree. */
  source?: ReviewSource;
  /** Optional: the checks the agent ran (Evidence card). */
  verification?: Verification;
  /** Optional: findings from other tools, shown on their lines (max 50). */
  findings?: AgentFinding[];
  /**
   * Absolute repo root. Standalone (non-Claude Code) harnesses only — there is
   * no hook event to supply a cwd, so the agent passes it. Ignored by the hook.
   */
  cwd?: string;
}

/* ------------------------------------------------------------------ */
/* 2. UI/SERVER CONTRACT — GET /api/review output                      */
/* ------------------------------------------------------------------ */

export interface ReviewMeta {
  aiGenerated: boolean;
  generatedBy: string; // model id
  generatedAt: string; // ISO timestamp
  promptVersion: string;
}

/** A CI check's state, from GitHub. */
export type CiCheckStatus = "passed" | "failed" | "pending" | "skipped";
export interface CiCheck {
  name: string;
  status: CiCheckStatus;
  /** The check's page on GitHub (https only). */
  url?: string;
}

/** Source B — from git/gh, not the agent. */
export interface PrMetadata {
  title: string;
  description: string; // author's original PR body (markdown)
  author: string;
  createdAt: string;
  base: string;
  head: string;
  url?: string; // phase 2
  /** Short CI summary, e.g. "12 passed, 1 failed". Set with `checks`. */
  ciStatus?: string;
  /**
   * The CI checks of the PR's head commit (`headRefOid`), read once when the
   * review opens. Undefined when there is no PR, no `gh`, or no checks.
   */
  checks?: CiCheck[];
  /**
   * True when some checks could not be read (a page failed, or too many
   * pages): `checks` may miss failures.
   */
  checksIncomplete?: boolean;
  /** PR head commit SHA (PR mode only) — drives file-content expansion. */
  headRefOid?: string;
}

/** A finding placed in the review. */
export interface ResolvedFinding {
  /** Per submission: hash of path + title, with occurrence suffixes for duplicates. */
  id: string;
  /** The path as the diff names it (the new path of a renamed file). */
  path: string;
  line: number;
  start_line?: number;
  side: CommentSide;
  severity: FindingSeverity;
  title: string;
  body?: string;
  source?: string;
  /**
   * The chapter that shows it: the one whose hunk covers the line, else the
   * first with the file. Undefined: the file is not in the diff (normal for
   * `pre_existing`); the Overview lists it under "Other findings".
   */
  chapterIndex?: number;
  /** The line is in the file but outside every hunk shown in that chapter. */
  outsideDiff?: boolean;
}

/** One end of a move: `lines` lines from `start`, in `path`. */
export interface MoveEnd {
  /** The file's path as the review names it (the new path of a renamed file). */
  path: string;
  /** First line: an old line number for `from`, a new one for `to`. */
  start: number;
  lines: number;
  /** The chapter whose hunk shows these lines. */
  chapterIndex: number;
}

/**
 * A block of lines removed in one place and added in another, unchanged
 * (`core/moves.ts`). Found by the tool in the real diff, never by the agent.
 * Two line ranges — no code text.
 */
export interface ResolvedMove {
  /** "m1", "m2", … in the order of the new places. */
  id: string;
  /**
   * "moved": the block left `from`. "copied": the same removed block also
   * went to an earlier `to`; this is one more place.
   */
  kind: "moved" | "copied";
  /** Where the lines were (old line numbers). */
  from: MoveEnd;
  /** Where they are now (new line numbers). */
  to: MoveEnd;
  /**
   * Absent: the two ends are identical, character for character. True: they
   * match only with leading and trailing whitespace ignored — which can be
   * plain re-indentation, or a real change (a multiline string's value,
   * Python or YAML structure). The tool cannot tell; the viewer says so.
   */
  whitespaceChanged?: boolean;
}

/** A resolved hunk: anchor + real content attached from git diff (B). */
export interface ResolvedHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  header: string; // full @@ ... @@ line
  /** Real unified-diff lines (" ctx", "+add", "-del"). */
  lines: string[];
}

export interface ResolvedFile {
  path: string;
  change_type: ChangeType;
  additions: number; // tool-computed
  deletions: number; // tool-computed
  language: string; // derived from extension
  hunks: ResolvedHunk[]; // resolved from B, scoped to this chapter
  /** True for binary files (no text hunks). From the real diff, not the agent. */
  binary?: boolean;
  /** Pre-rename path when change_type === "renamed". */
  old_path?: string;
}

export interface ResolvedChapter {
  index: number;
  title: string;
  risk: Risk;
  risk_reason: string;
  additions: number; // tool-computed
  deletions: number; // tool-computed
  fileCount: number;
  description: string;
  files: ResolvedFile[];
}

export interface ReviewStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

/** Exactly what GET /api/review returns to the React app. */
export interface ResolvedReview {
  meta: ReviewMeta;
  pr: PrMetadata;
  prologue: Prologue;
  stats: ReviewStats;
  chapters: ResolvedChapter[];
  /** The agent's reported checks, passed through as sent. */
  verification?: Verification;
  /** Findings from other tools, placed by `resolveFindings`. Absent when none. */
  findings?: ResolvedFinding[];
  /** Moved and copied blocks, found in the real diff. Absent when none. */
  moves?: ResolvedMove[];
  /**
   * What changed since the reviewer last asked for changes. Absent on the
   * first round, and wherever rounds don't apply (see RoundInfo).
   */
  round?: RoundInfo;
  /**
   * Resolution warnings — places the agent's narrative didn't map cleanly onto
   * the real diff (unmatched anchors, files not in the diff, unsorted changes).
   * Shown to the reviewer; empty when resolution was clean.
   */
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Reviewer → agent (POST /api/done): the verdict and line comments     */
/* ------------------------------------------------------------------ */

/** Which side of the diff a line number counts on: base ("old") or changed ("new"). */
export type CommentSide = "old" | "new";

/**
 * A reviewer's comment on diff lines. `side` + `line` is its last line;
 * `startSide` + `startLine` its first, only when it covers more than one line.
 * Lines are references into the real diff (source B), never their text.
 */
export interface ReviewComment {
  /** The chapter's stable `index`: a file can be in two chapters. */
  chapterIndex: number;
  path: string;
  side: CommentSide;
  line: number;
  startSide?: CommentSide;
  startLine?: number;
  /** Markdown. */
  body: string;
}

/**
 * Whether the lines a previous round's comment was on have changed since. Not
 * "fixed": the tool can see that the lines changed, only the reviewer can say
 * the comment was handled.
 */
export type CommentStatus = "lines_changed" | "lines_unchanged";

/** A comment from the previous round, with what happened to its lines since. */
export interface PreviousComment extends ReviewComment {
  status: CommentStatus;
}

/**
 * This review's place in a chain of rounds (plan 020). Present from the second
 * submission of the same change on, and only where a verdict can travel: with
 * round-trip off, or in the desktop app, there is no agent loop and no rounds.
 */
export interface RoundInfo {
  /** 2 for the first re-review, and up. Round 1 has no `RoundInfo` at all. */
  number: number;
  /** Paths whose diff differs from the previous round's, plus paths that are new. */
  changedPaths: string[];
  /** Paths the reviewer had marked viewed and the agent has not touched since. */
  viewedPaths: string[];
  previousComments: PreviousComment[];
  /**
   * How many findings were left out because the reviewer dismissed them in an
   * earlier round. Absent when none were.
   */
  hiddenFindings?: number;
}

export type ReviewVerdict = "approve" | "request_changes";

/** What the reviewer decided about one finding. */
export type FindingDecision = "fix" | "dismiss";

/**
 * The reviewer's answer to a finding, by its `ResolvedFinding.id`. Only the
 * decision and a reason travel: the finding's own text came from the agent,
 * and the tool does not send it back.
 */
export interface FindingAnswer {
  id: string;
  decision: FindingDecision;
  /**
   * Why it was dismissed — the agent must not raise it again. At most
   * MAX_FINDING_REASON characters: the viewer holds the reviewer to it, and
   * the server refuses a longer one.
   */
  reason?: string;
}

/**
 * How long a dismissal reason may be. The viewer's field stops there and the
 * `/api/done` schema refuses more, so a reason the reviewer can type is always
 * one the review can be submitted with. (The agent sees it cut much shorter —
 * see MAX_REASON_CHARS in messages.ts.)
 */
export const MAX_FINDING_REASON = 2000;

/** What the viewer sends when the reviewer finishes. Empty = Done with no round-trip. */
export interface DoneResult {
  verdict?: ReviewVerdict;
  /** The reviewer's overall note (Markdown), with "request changes". */
  summary?: string;
  /** Line comments, sent with the verdict when round-trip is on. */
  comments?: ReviewComment[];
  /** Answers to the findings the review carried (`ResolvedReview.findings`). */
  findings?: FindingAnswer[];
  /**
   * Paths the reviewer marked viewed, so the next round can carry the marks
   * over (plan 020). A path is here only when every chapter that showed the
   * file had it marked.
   */
  viewed?: string[];
}

/**
 * An answer joined back onto the finding it answers — what the agent is told.
 * The join happens where the resolved review is known (the server), so the
 * location and title are the tool's own, not the browser's.
 */
export interface AnsweredFinding
  extends Pick<ResolvedFinding, "path" | "line" | "start_line" | "side" | "severity" | "title">,
    Pick<FindingAnswer, "decision" | "reason"> {}

/* ------------------------------------------------------------------ */
/* Client-only view state (source D — cookies/localStorage)            */
/* ------------------------------------------------------------------ */

export type DiffLayout = "unified" | "split";

export interface DisplaySettings {
  layout: DiffLayout;
  /** Color mode: "auto" follows prefers-color-scheme. */
  theme: "auto" | "light" | "dark";
  /** Syntax theme used in light mode (a @pierre/diffs / Shiki theme id). */
  lightTheme: string;
  /** Syntax theme used in dark mode (a @pierre/diffs / Shiki theme id). */
  darkTheme: string;
  /** Code font id from the viewer's font catalog ("system" = the OS monospace). */
  font: string;
  /** Code font size in px. */
  fontSize: number;
  /** Render programming ligatures (e.g. `!==` as one glyph). */
  ligatures: boolean;
  changeIndicator: "classic" | "bars" | "none";
  granularity: "line" | "word" | "char";
  wrap: boolean;
  lineNumbers: boolean;
  backgrounds: boolean;
}
