/**
 * Review progress from the viewed flags (`"chapterIndex:path"` entries, see
 * chapterFileSet.ts): per chapter for the overview, and over the whole review
 * for the check before Done.
 */
import type { ResolvedChapter } from "@review-buddy/core/types";
import { chapterPathSet } from "./chapterPathSet.ts";

export interface ChapterProgress {
  viewedCount: number;
  complete: boolean;
}

export function progressByChapter(
  chapters: readonly ResolvedChapter[],
  viewedEntries: readonly string[],
): ChapterProgress[] {
  return chapters.map((ch) => {
    // Intersect with chapter files so stale entries for removed paths don't inflate the count.
    const viewed = chapterPathSet(viewedEntries, ch.index);
    const viewedCount = ch.files.filter((f) => viewed.has(f.path)).length;
    return {
      viewedCount,
      complete: ch.fileCount > 0 && viewedCount === ch.fileCount,
    };
  });
}

/**
 * Files marked viewed over the whole review. Counted per chapter, as on the
 * overview: a file whose hunks span two chapters counts in both.
 */
export function reviewProgress(
  chapters: readonly ResolvedChapter[],
  viewedEntries: readonly string[],
): { viewed: number; total: number } {
  const progress = progressByChapter(chapters, viewedEntries);
  return {
    viewed: progress.reduce((sum, p) => sum + p.viewedCount, 0),
    total: chapters.reduce((sum, ch) => sum + ch.fileCount, 0),
  };
}
