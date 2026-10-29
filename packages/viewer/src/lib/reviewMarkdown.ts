import type { ResolvedChapter, ResolvedFile, ResolvedReview } from "@review-buddy/core/types";
import { commentsToMarkdown, type LineComment } from "./comments.ts";

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
 * Narrative + inventory Markdown for one chapter, and the reviewer's comments
 * on it. Never includes hunk line content.
 */
export function chapterToMarkdown(
  chapter: ResolvedChapter,
  headingLevel: 2 | 3 = 2,
  comments: readonly LineComment[] = [],
): string {
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
): string {
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

  if (chapters.length > 0) {
    parts.push("", "## Chapters", "");
    parts.push(
      chapters
        .map((c) =>
          chapterToMarkdown(
            c,
            3,
            comments.filter((x) => x.chapterIndex === c.index),
          ),
        )
        .join("\n\n"),
    );
  }

  if (warnings.length > 0) {
    parts.push("", "## Resolution notes", "", ...warnings.map((w) => `- ${w}`));
  }

  return parts.join("\n");
}
