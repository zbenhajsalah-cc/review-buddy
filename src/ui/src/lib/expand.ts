/**
 * Full-file expansion helpers. @pierre/diffs can only expand unchanged context
 * when it holds the WHOLE file (FileDiffMetadata.isPartial === false); the
 * <PatchDiff> path (isPartial: true) structurally can't. So expansion fetches the
 * authoritative base/head bytes from /api/file-content and rebuilds the diff via
 * parseDiffFromFile, then <FileDiff> renders it with expandUnchanged. The bytes
 * are git's (reference-not-reproduce); we only re-frame them.
 */
import { type FileDiffMetadata, parseDiffFromFile } from "@pierre/diffs";
import type { ResolvedFile } from "@review-buddy/core/types";

/** Which sides must carry real bytes for a faithful full-file diff of this change. */
export function requiredSides(changeType: ResolvedFile["change_type"]): {
  base: boolean;
  head: boolean;
} {
  return { base: changeType !== "added", head: changeType !== "deleted" };
}

/**
 * True when we hold the bytes needed to render a faithful expanded diff. A
 * required side arriving as "" means unavailable (not on disk / PR-mode per plan
 * 008, or a rename whose old_path isn't allowlisted) — it must NOT be rendered as
 * an empty file.
 */
export function canExpand(file: ResolvedFile, base: string, head: string): boolean {
  const req = requiredSides(file.change_type);
  return !(req.base && base === "") && !(req.head && head === "");
}

/** Rebuild a whole-file (isPartial:false) diff so <FileDiff> can expandUnchanged. */
export function buildExpandedDiff(
  file: ResolvedFile,
  base: string,
  head: string,
): FileDiffMetadata {
  return parseDiffFromFile(
    { name: file.old_path ?? file.path, contents: base },
    { name: file.path, contents: head },
  );
}
