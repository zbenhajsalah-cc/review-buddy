/**
 * Local per-file flag state (viewed / collapsed) — Phase 1 = client-only, no round-trip.
 * Keyed per review (`ReviewApi.reviewKey`) AND per chapter: the same file can
 * appear in multiple chapters with different hunks, so flag state is
 * namespaced by the chapter's stable `index`. Persisted to localStorage so it
 * survives a reload within the same review, and cleared when the review is
 * submitted.
 */
import { useCallback } from "react";
import { useReviewApi } from "../review-api.tsx";
import { chapterPathSet } from "./chapterPathSet.ts";
import { parseStored, usePersistedState } from "./usePersistedState.ts";

const PREFIXES = ["viewed", "collapsed"] as const;
type Prefix = (typeof PREFIXES)[number];

const key = (prefix: Prefix, reviewKey: string) => `rb.${prefix}.${reviewKey || "nokey"}`;

function createChapterFileSet(prefix: Prefix) {
  return function useChapterFileSet(chapterIndex: number) {
    // The key is fixed for the life of a mounted viewer: one ReviewViewer
    // shows one review.
    const KEY = key(prefix, useReviewApi().reviewKey);
    const [entries, setEntries] = usePersistedState<string[]>(KEY, [], "local");
    const set = chapterPathSet(entries, chapterIndex);
    const update = useCallback(
      (path: string, value: boolean) => {
        const entry = `${chapterIndex}:${path}`;
        setEntries((prev) => {
          const has = prev.includes(entry);
          if (value) return has ? prev : [...prev, entry];
          return has ? prev.filter((e) => e !== entry) : prev;
        });
      },
      [setEntries, chapterIndex],
    );
    return [set, update] as const;
  };
}

export const useViewedFiles = createChapterFileSet("viewed");
export const useCollapsedFiles = createChapterFileSet("collapsed");

/**
 * Snapshot of viewed `"chapterIndex:path"` entries for this review.
 * A one-shot read is enough: App renders Overview and ChapterReview as
 * alternatives, so returning from a chapter always remounts Overview.
 * This is a deliberate design contract, not an accident.
 */
export function readViewedEntries(reviewKey: string): readonly string[] {
  try {
    return parseStored(localStorage.getItem(key("viewed", reviewKey)), [] as string[]);
  } catch {
    return [];
  }
}

/**
 * Drop THIS review's viewed + collapsed state. Called when the review is
 * submitted (Done) so a completed review doesn't leave its keys behind. Scoped
 * to this review's keys only — it never touches another review's keys, so it
 * cannot disturb a parallel review (another origin in the plugin, another
 * review in the same desktop window).
 */
export function clearReviewFileState(reviewKey: string) {
  for (const prefix of PREFIXES) {
    try {
      localStorage.removeItem(key(prefix, reviewKey));
    } catch {
      /* storage unavailable (private mode) — non-fatal */
    }
  }
}
