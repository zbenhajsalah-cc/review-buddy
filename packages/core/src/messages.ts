/**
 * Agent-facing feedback text, shared by every entry point: the Claude Code hook
 * (deny reason / `additionalContext`), standalone MCP tool results, and any
 * future runner that hands review results back to an agent.
 */
import type { ReviewComment } from "./types.ts";

/** "line 12 (new)", "lines 10-14 (new)", or "lines 7 (old) to 9 (new)". */
export function describeLines(
  r: Pick<ReviewComment, "side" | "line" | "startSide" | "startLine">,
): string {
  if (r.startLine === undefined) return `line ${r.line} (${r.side})`;
  const startSide = r.startSide ?? r.side;
  if (startSide === r.side) return `lines ${r.startLine}-${r.line} (${r.side})`;
  return `lines ${r.startLine} (${startSide}) to ${r.line} (${r.side})`;
}

/** One comment as a Markdown list item; a body of several lines stays inside the item. */
export function commentToMarkdown(c: Omit<ReviewComment, "chapterIndex">): string {
  return `- \`${c.path}\` ${describeLines(c)}: ${c.body.trim().replace(/\n/g, "\n  ")}`;
}

// Claude Code moves hook text over 10,000 characters (`additionalContext`) to
// a file the agent is not told to read. The reviewer's feedback stays well
// under it, so it still fits next to the resolution notes.
const MAX_FEEDBACK_CHARS = 6000;
const MAX_SUMMARY_CHARS = 2000;
const MAX_COMMENT_CHARS = 1000;

const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max).trimEnd()} … (cut)`;

/**
 * The comments as a Markdown list, by file and line, in at most `budget`
 * characters: long bodies are cut, and comments that do not fit are counted.
 */
function commentsBlock(comments: readonly ReviewComment[], budget: number): string {
  const sorted = [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const lines = [
    `${comments.length} line comment${comments.length === 1 ? "" : "s"} ` +
      `("new" is a line of the changed version, "old" a line of the base version):`,
  ];
  let used = lines[0]!.length;
  for (const c of sorted) {
    const item = commentToMarkdown({ ...c, body: cut(c.body.trim(), MAX_COMMENT_CHARS) });
    if (used + item.length + 1 > budget) break;
    lines.push(item);
    used += item.length + 1;
  }
  const omitted = sorted.length - (lines.length - 1);
  if (omitted > 0) {
    lines.push(`…and ${omitted} more not shown: the feedback was too long for one message.`);
  }
  return lines.join("\n");
}

/** The note, then the comments, in one message of at most MAX_FEEDBACK_CHARS. */
function feedback(head: string, comments: readonly ReviewComment[]): string {
  if (comments.length === 0) return head;
  return `${head}\n\n${commentsBlock(comments, MAX_FEEDBACK_CHARS - head.length)}`;
}

const noteOf = (summary: string | undefined): string =>
  cut(summary?.trim() ?? "", MAX_SUMMARY_CHARS);

/**
 * Reviewer's request-changes verdict as a human/agent-readable message — the
 * hook's deny reason and blocking standalone's tool result share this wording.
 * The note comes first, then the line comments; the whole text is capped.
 */
export function requestChangesMessage(
  summary: string | undefined,
  comments: readonly ReviewComment[] = [],
): string {
  const note = noteOf(summary);
  if (!note && comments.length === 0) {
    return "Reviewer requested changes (no details provided) — re-examine the flagged chapters.";
  }
  return feedback(
    note ? `Reviewer requested changes:\n\n${note}` : "Reviewer requested changes.",
    comments,
  );
}

/**
 * What the reviewer said with an approval, for the agent (the hook's
 * `additionalContext`, blocking standalone's tool result). Undefined when
 * they approved without a note or comments.
 */
export function approvalMessage(
  summary: string | undefined,
  comments: readonly ReviewComment[] = [],
): string | undefined {
  const note = noteOf(summary);
  if (!note && comments.length === 0) return undefined;
  return feedback(
    note ? `Reviewer approved, with a note:\n\n${note}` : "Reviewer approved, with comments.",
    comments,
  );
}

const MAX_RESOLUTION_NOTES = 10;

/**
 * Format resolution/coverage warnings for the agent-visible feedback channel
 * (hook `additionalContext` / standalone tool-result text). Empty → undefined
 * so callers can omit the block entirely. Caps bullets so a pathological
 * review can't blow the agent's context window.
 */
export function resolutionNotesMessage(warnings: readonly string[]): string | undefined {
  if (warnings.length === 0) return undefined;
  const shown = warnings.slice(0, MAX_RESOLUTION_NOTES);
  const omitted = warnings.length - shown.length;
  const lines = [
    `${warnings.length} resolution note${warnings.length === 1 ? "" : "s"} — ` +
      `places the tool could not map this review onto the real diff:`,
    ...shown.map((w) => `- ${w}`),
  ];
  if (omitted > 0) {
    lines.push(`…and ${omitted} more omitted.`);
  }
  lines.push(
    "If you submit this diff again, correct the file paths and hunk anchors " +
      "(`old_start` / `new_start` from the `@@` headers).",
  );
  return lines.join("\n");
}

/** The parts that are present, joined by a blank line; undefined when none is. */
export function joinMessages(...parts: (string | undefined)[]): string | undefined {
  const present = parts.filter((p): p is string => !!p);
  return present.length > 0 ? present.join("\n\n") : undefined;
}
