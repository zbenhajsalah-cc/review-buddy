/**
 * Local per-file flag state (viewed / collapsed) — Phase 1 = client-only, no round-trip.
 * Keyed per review token AND per chapter: the same file can appear in multiple
 * chapters with different hunks, so flag state is namespaced by the chapter's
 * stable `index`. Persisted to localStorage so it survives a reload within the
 * same review session, and cleared when the review is submitted.
 */
import { useCallback } from "react";
import { getReviewToken } from "../session.ts";
import { chapterPathSet } from "./chapterPathSet.ts";
import { parseStored, usePersistedState } from "./usePersistedState.ts";

const PREFIXES = ["viewed", "collapsed"] as const;
type Prefix = (typeof PREFIXES)[number];

const key = (prefix: Prefix) => `rb.${prefix}.${getReviewToken() || "notoken"}`;

function createChapterFileSet(prefix: Prefix) {
  // Fixed at factory time: getReviewToken() memoizes at module load (session.ts), so the token
  // can't change without a reload — and a parallel review runs on its own origin anyway.
  const KEY = key(prefix);
  return function useChapterFileSet(chapterIndex: number) {
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
export function readViewedEntries(): readonly string[] {
  try {
    return parseStored(localStorage.getItem(key("viewed")), [] as string[]);
  } catch {
    return [];
  }
}

/**
 * Drop THIS review's viewed + collapsed state. Called when the review is
 * submitted (Done) so a completed review doesn't leave its keys behind. Scoped
 * to this session's keys only — it never touches another review's keys, so it
 * cannot disturb a parallel review running on its own ephemeral-port origin.
 */
export function clearReviewFileState() {
  for (const prefix of PREFIXES) {
    try {
      localStorage.removeItem(key(prefix));
    } catch {
      /* storage unavailable (private mode) — non-fatal */
    }
  }
}
