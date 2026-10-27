/**
 * Reconstruct a unified-diff patch string for one resolved file so it can be
 * handed to @pierre/diffs' <PatchDiff>. We already hold the authoritative hunk
 * bytes from the server (reference-not-reproduce); this just re-frames them with
 * the git file headers @pierre/diffs expects.
 */
import type { ResolvedFile } from "@review-buddy/core/types";

export function fileToPatch(f: ResolvedFile): string {
  const oldPath = f.old_path ?? f.path;
  const oldName = f.change_type === "added" ? "/dev/null" : `a/${oldPath}`;
  const newName = f.change_type === "deleted" ? "/dev/null" : `b/${f.path}`;

  const header = `diff --git a/${oldPath} b/${f.path}\n` + `--- ${oldName}\n` + `+++ ${newName}\n`;

  const body = f.hunks.map((h) => `${h.header}\n${h.lines.join("\n")}`).join("\n");

  // Trailing newline keeps the last hunk line well-formed for the parser.
  return body ? `${header}${body}\n` : header;
}
