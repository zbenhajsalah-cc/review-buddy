/**
 * Build the set of file paths for a chapter from raw stored entries.
 * Tolerates a corrupted array (non-string elements from tamper / a schema change
 * across versions) rather than throwing — a TypeError here would blow up the
 * whole viewer via the ErrorBoundary. Entries are `"chapterIndex:path"`.
 */
export function chapterPathSet(entries: readonly unknown[], chapterIndex: number): Set<string> {
  const prefix = `${chapterIndex}:`;
  return new Set(
    entries
      .filter((e): e is string => typeof e === "string" && e.startsWith(prefix))
      .map((e) => e.slice(prefix.length)),
  );
}
