/**
 * The viewer's side of rounds (plan 020): carrying viewed marks across a
 * re-review, and reporting them back so the next round can do the same.
 *
 * Why this is needed at all: the plugin serves each submission on a new
 * ephemeral port, and a new port is a new origin with its own empty
 * localStorage. The marks cannot survive in the browser, so they travel —
 * out with the verdict (`DoneResult.viewed`), back in on the review
 * (`ResolvedReview.round.viewedPaths`), and are written into this round's
 * storage once, before the screens first read it.
 */
import type { ResolvedChapter, ResolvedReview } from "@review-buddy/core/types";
import { reviewStorageKey } from "./chapterFileSet.ts";
import { chapterPathSet } from "./chapterPathSet.ts";

/**
 * Paths viewed over the whole review. A file can be in two chapters with
 * different hunks, so it counts as viewed only when every chapter that showed
 * it was marked — half a file read is not a file read.
 */
export function fullyViewedPaths(
  chapters: readonly ResolvedChapter[],
  viewedEntries: readonly string[],
): string[] {
  const seen = new Map<string, { shown: number; viewed: number }>();
  for (const chapter of chapters) {
    const viewed = chapterPathSet(viewedEntries, chapter.index);
    for (const file of chapter.files) {
      const count = seen.get(file.path) ?? { shown: 0, viewed: 0 };
      count.shown++;
      if (viewed.has(file.path)) count.viewed++;
      seen.set(file.path, count);
    }
  }
  return [...seen].filter(([, c]) => c.shown === c.viewed).map(([path]) => path);
}

/**
 * Mark the files the agent has not touched since the reviewer last saw them,
 * so a re-review starts where the last one left off.
 *
 * Called once per loaded review, before the screens mount and read the key.
 * It only ever seeds: if this round already has viewed state — the reviewer
 * reloaded the page — that state is theirs and stands untouched.
 *
 * Returns the paths it marked (for tests and for a caller that wants to say
 * so); an empty list when there was nothing to carry over.
 */
export function seedViewedFromRound(review: ResolvedReview, reviewKey: string): string[] {
  const carried = review.round?.viewedPaths ?? [];
  if (carried.length === 0) return [];
  const key = reviewStorageKey("viewed", reviewKey);
  try {
    if (localStorage.getItem(key) !== null) return [];
    const paths = new Set(carried);
    const entries: string[] = [];
    const marked = new Set<string>();
    for (const chapter of review.chapters) {
      for (const file of chapter.files) {
        if (!paths.has(file.path)) continue;
        entries.push(`${chapter.index}:${file.path}`);
        marked.add(file.path);
      }
    }
    if (entries.length > 0) localStorage.setItem(key, JSON.stringify(entries));
    return [...marked];
  } catch {
    // Storage unavailable (private mode): the review opens with nothing marked,
    // which is the old behaviour and not worth failing over.
    return [];
  }
}
