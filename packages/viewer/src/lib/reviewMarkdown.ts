import type {
  FindingAnswer,
  ResolvedChapter,
  ResolvedFile,
  ResolvedFinding,
  ResolvedReview,
} from "@review-buddy/core/types";
import { commentsToMarkdown, type LineComment } from "./comments.ts";
import {
  AGENT_STATUS_LABEL,
  agentChecksInOrder,
  ciChecksToShow,
  hasNoEvidence,
} from "./evidence.ts";
import { answersById, chapterFindings, findingToMarkdown, otherFindings } from "./findings.ts";

function pluralFiles(n: number): string {
  return `${n} file${n === 1 ? "" : "s"}`;
}

function diffCounts(additions: number, deletions: number): string {
  return `+${additions}/-${deletions}`;
}

function fileBullet(file: ResolvedFile): string {
  const pathLabel = file.old_path !== undefined ? `${file.old_path} → ${file.path}` : file.path;
  const typeLabel = file.binary ? `${file.change_type}, binary` : file.change_type;
  return `- ${pathLabel} (${typeLabel}) ${diffCounts(file.additions, file.deletions)}`;
}

/**
 * Narrative + inventory Markdown for one chapter, with the reviewer's comments
 * on it and the findings it carries (each with its answer, when it has one).
 * Never includes hunk line content.
 */
export function chapterToMarkdown(
  chapter: ResolvedChapter,
  headingLevel: 2 | 3 = 2,
  comments: readonly LineComment[] = [],
  findings: readonly ResolvedFinding[] = [],
  answers: readonly FindingAnswer[] = [],
): string {
  const answerOf = answersById(answers);
  const heading = "#".repeat(headingLevel);
  const parts: string[] = [
    `${heading} ${String(chapter.index).padStart(2, "0")} ${chapter.title}`,
    "",
    `${chapter.risk} — ${chapter.risk_reason} · ${diffCounts(chapter.additions, chapter.deletions)} · ${pluralFiles(chapter.fileCount)}`,
  ];

  if (chapter.description.length > 0) {
    parts.push("", chapter.description);
  }

  if (chapter.files.length > 0) {
    parts.push("", ...chapter.files.map(fileBullet));
  }

  if (findings.length > 0) {
    parts.push(
      "",
      "**Findings**",
      "",
      ...findings.map((f) => findingToMarkdown(f, answerOf.get(f.id))),
    );
  }

  if (comments.length > 0) {
    parts.push("", "**Comments**", "", commentsToMarkdown(comments));
  }

  return parts.join("\n");
}

/**
 * Full-review Markdown (prologue + chapters with their comments + optional
 * warnings). No hunk line content.
 */
export function reviewToMarkdown(
  review: ResolvedReview,
  comments: readonly LineComment[] = [],
  answers: readonly FindingAnswer[] = [],
): string {
  const answerOf = answersById(answers);
  const title = review.pr.title || "Untitled review";
  const { pr, prologue, stats, chapters, warnings } = review;

  const parts: string[] = [
    `# ${title}`,
    "",
    `${pr.author || "unknown"} · ${pr.base} ← ${pr.head} · ${diffCounts(stats.additions, stats.deletions)} · ${pluralFiles(stats.filesChanged)}`,
    "",
    "## Prologue",
    "",
    "**Why**",
    "",
    prologue.why,
    "",
    "**What**",
    "",
    prologue.what,
  ];

  if (prologue.key_changes.length > 0) {
    parts.push(
      "",
      "**Key changes**",
      "",
      ...prologue.key_changes.map((k) => `- **${k.headline}** — ${k.detail}`),
    );
  }

  parts.push(
    "",
    "**Review focus**",
    "",
    `${prologue.review_focus.summary} \`${prologue.review_focus.file}\``,
  );

  const questions = prologue.open_questions ?? [];
  if (questions.length > 0) {
    parts.push(
      "",
      "**Before you read the code**",
      "",
      ...questions.map((q) => (q.context ? `- ${q.question} — ${q.context}` : `- ${q.question}`)),
    );
  }

  if (!hasNoEvidence(review)) {
    parts.push("", "## Evidence", "", evidenceToMarkdown(review));
  }

  if (chapters.length > 0) {
    parts.push("", "## Chapters", "");
    parts.push(
      chapters
        .map((c) =>
          chapterToMarkdown(
            c,
            3,
            comments.filter((x) => x.chapterIndex === c.index),
            chapterFindings(review.findings, c.index),
            answers,
          ),
        )
        .join("\n\n"),
    );
  }

  const others = otherFindings(review.findings);
  if (others.length > 0) {
    parts.push(
      "",
      "## Other findings",
      "",
      ...others.map((f) => findingToMarkdown(f, answerOf.get(f.id))),
    );
  }

  if (warnings.length > 0) {
    parts.push("", "## Resolution notes", "", ...warnings.map((w) => `- ${w}`));
  }

  return parts.join("\n");
}

/** Check names, commands and states only: never any output. */
function evidenceToMarkdown(review: ResolvedReview): string {
  const out: string[] = [];
  const ci = review.pr.checks ?? [];
  if (ci.length > 0) {
    out.push(`**CI (GitHub)**: ${review.pr.ciStatus || `${ci.length} checks`}`);
    const shown = ciChecksToShow(ci);
    if (shown.length > 0) out.push("", ...shown.map((c) => `- ${c.name} — ${c.status}`));
    if (review.pr.checksIncomplete) {
      out.push("", "Some checks could not be read, so this list may miss failures.");
    }
  }
  const agent = agentChecksInOrder(review.verification?.checks ?? []);
  if (agent.length > 0) {
    if (out.length > 0) out.push("");
    out.push(
      "**Reported by the agent**",
      "",
      ...agent.map(
        (c) =>
          `- \`${c.command}\` — ${AGENT_STATUS_LABEL[c.status]}${c.summary ? ` (${c.summary})` : ""}`,
      ),
    );
  }
  const notCovered = review.verification?.not_covered?.trim();
  if (notCovered) {
    if (out.length > 0) out.push("");
    out.push(`**Not covered:** ${notCovered}`);
  }
  return out.join("\n");
}
