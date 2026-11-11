/**
 * Agent-facing feedback text, shared by every entry point: the Claude Code hook
 * (deny reason / `additionalContext`), standalone MCP tool results, and any
 * future runner that hands review results back to an agent.
 */
import type {
  AnsweredFinding,
  FindingAnswer,
  FindingSeverity,
  ResolvedFinding,
  ReviewComment,
} from "./types.ts";

/** Most severe first — the order findings are listed in, everywhere. */
export const FINDING_SEVERITIES: readonly FindingSeverity[] = ["important", "nit", "pre_existing"];

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
const MAX_REASON_CHARS = 300;
/** Between the blocks of one message. */
const SEPARATOR = "\n\n";

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

/**
 * The reviewer's answers joined onto the findings they answer, most severe
 * first. The text comes from the resolved review, never from the answer: the
 * browser sends ids and a decision, and an id this review does not have is
 * dropped (a stale answer from an earlier round).
 */
export function answeredFindings(
  findings: readonly ResolvedFinding[] | undefined,
  answers: readonly FindingAnswer[] | undefined,
): AnsweredFinding[] {
  if (!findings?.length || !answers?.length) return [];
  const byId = new Map(findings.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const out: AnsweredFinding[] = [];
  for (const a of answers) {
    const f = byId.get(a.id);
    if (!f || seen.has(a.id)) continue;
    seen.add(a.id);
    const reason = a.reason?.trim();
    out.push({
      path: f.path,
      line: f.line,
      start_line: f.start_line,
      side: f.side,
      severity: f.severity,
      title: f.title,
      decision: a.decision,
      ...(reason ? { reason } : {}),
    });
  }
  return out.sort(
    (a, b) =>
      FINDING_SEVERITIES.indexOf(a.severity) - FINDING_SEVERITIES.indexOf(b.severity) ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  );
}

/** One answered finding: where it is and its title — never its body. */
function findingToMarkdown(f: AnsweredFinding): string {
  const where = describeLines({ side: f.side, line: f.line, startLine: f.start_line });
  const reason = f.reason ? ` — "${cut(f.reason, MAX_REASON_CHARS)}"` : "";
  return `- \`${f.path}\` ${where}: ${f.title}${reason}`;
}

/**
 * The answers as two lists — to fix, and dismissed — in at most `budget`
 * characters. Answers that do not fit are counted, like comments.
 */
function findingsBlock(findings: readonly AnsweredFinding[], budget: number): string | undefined {
  const groups = [
    { decision: "fix", head: "Findings to fix:" },
    {
      decision: "dismiss",
      head: "Dismissed by the reviewer (do not raise these again):",
    },
  ] as const;
  const lines: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const group of groups) {
    const items = findings.filter((f) => f.decision === group.decision).map(findingToMarkdown);
    if (items.length === 0) continue;
    // A heading with nothing under it says nothing: keep it only if an item fits.
    const start = lines.length;
    let kept = 0;
    lines.push(group.head);
    used += group.head.length + 1;
    for (const item of items) {
      if (used + item.length + 1 > budget) {
        omitted++;
        continue;
      }
      lines.push(item);
      used += item.length + 1;
      kept++;
    }
    if (kept === 0) {
      lines.length = start;
      used -= group.head.length + 1;
    }
  }
  if (lines.length === 0) return undefined;
  if (omitted > 0) {
    lines.push(`…and ${omitted} more answered, not shown: the feedback was too long.`);
  }
  return lines.join("\n");
}

/**
 * The note, then the comments, then the answered findings, in one message of
 * at most MAX_FEEDBACK_CHARS. Comments come first: they are the reviewer's own
 * words, while an answer is a decision about text the agent already has.
 */
function feedback(
  head: string,
  comments: readonly ReviewComment[],
  findings: readonly AnsweredFinding[],
): string {
  const parts = [head];
  let left = MAX_FEEDBACK_CHARS - head.length;
  // Comments first, but many long comments must not swallow the answers whole:
  // the answers keep up to a third of the room while they need it.
  const reserved = findings.length > 0 ? Math.floor(left / 3) : 0;
  if (comments.length > 0) {
    left -= SEPARATOR.length;
    const block = commentsBlock(comments, left - reserved);
    parts.push(block);
    left -= block.length;
  }
  if (findings.length > 0 && left > SEPARATOR.length) {
    const block = findingsBlock(findings, left - SEPARATOR.length);
    if (block) parts.push(block);
  }
  return parts.join(SEPARATOR);
}

const noteOf = (summary: string | undefined): string =>
  cut(summary?.trim() ?? "", MAX_SUMMARY_CHARS);

/**
 * Reviewer's request-changes verdict as a human/agent-readable message — the
 * hook's deny reason and blocking standalone's tool result share this wording.
 * The note comes first, then the line comments, then the answered findings;
 * the whole text is capped.
 */
export function requestChangesMessage(
  summary: string | undefined,
  comments: readonly ReviewComment[] = [],
  findings: readonly AnsweredFinding[] = [],
): string {
  const note = noteOf(summary);
  if (!note && comments.length === 0 && findings.length === 0) {
    return "Reviewer requested changes (no details provided) — re-examine the flagged chapters.";
  }
  return feedback(
    note ? `Reviewer requested changes:\n\n${note}` : "Reviewer requested changes.",
    comments,
    findings,
  );
}

/**
 * What the reviewer said with an approval, for the agent (the hook's
 * `additionalContext`, blocking standalone's tool result). Undefined when
 * they approved without a note, comments or answered findings.
 */
export function approvalMessage(
  summary: string | undefined,
  comments: readonly ReviewComment[] = [],
  findings: readonly AnsweredFinding[] = [],
): string | undefined {
  const note = noteOf(summary);
  if (!note && comments.length === 0 && findings.length === 0) return undefined;
  const head = note
    ? `Reviewer approved, with a note:\n\n${note}`
    : comments.length > 0
      ? "Reviewer approved, with comments."
      : "Reviewer approved, and answered the findings.";
  return feedback(head, comments, findings);
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
