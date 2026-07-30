/**
 * Resolution: merge the agent's narrative (source A) onto the authoritative
 * git diff (source B). Implements docs/review-contract.md §"Resolution step".
 *
 *   1. Parse the real diff into files -> hunks (diff.ts).
 *   2. For each agent chapter file, attach the real hunks whose anchors match
 *      (omitted `hunks` => attach all of that file's hunks).
 *   3. Recompute additions/deletions per file, per chapter, and overall.
 *   4. Any real hunk not claimed by any chapter => synthetic "Unsorted changes"
 *      chapter, except noise files (lockfiles, images, …) which go into a
 *      separate "Generated & noise files" chapter (never drop changes).
 *
 * The agent supplies judgment + grouping; git supplies the bytes.
 */
import type {
  AgentReview,
  PrMetadata,
  ResolvedChapter,
  ResolvedFile,
  ResolvedHunk,
  ResolvedReview,
  ReviewMeta,
  ReviewStats,
} from "../types/review.ts";
import { languageOf, type ParsedFile, type ParsedHunk, parseDiff } from "./diff.ts";
import { isNoiseFile } from "./noise.ts";

export interface ResolveResult {
  review: ResolvedReview;
  warnings: string[];
}

const UNSORTED_TITLE = "Unsorted changes";
const NOISE_TITLE = "Generated & noise files";

function normalizePath(p: string): string {
  return p.replace(/^\.\//, "").replace(/^\/+/, "");
}

function toResolvedHunk(h: ParsedHunk): ResolvedHunk {
  return {
    old_start: h.oldStart,
    old_lines: h.oldLines,
    new_start: h.newStart,
    new_lines: h.newLines,
    header: h.header,
    lines: h.lines,
  };
}

function resolvedFileFrom(file: ParsedFile, hunks: ParsedHunk[]): ResolvedFile {
  return {
    path: file.path,
    change_type: file.changeType,
    additions: hunks.reduce((n, h) => n + h.additions, 0),
    deletions: hunks.reduce((n, h) => n + h.deletions, 0),
    language: languageOf(file.path),
    hunks: hunks.map(toResolvedHunk),
    ...(file.binary ? { binary: true } : {}),
    ...(file.changeType === "renamed" && file.oldPath ? { old_path: file.oldPath } : {}),
  };
}

/** Synthetic leftover/noise chapter — same shape for both buckets. */
function bucketChapter(
  files: ResolvedFile[],
  index: number,
  title: string,
  risk_reason: string,
  description: string,
): ResolvedChapter {
  return {
    index,
    title,
    risk: "Low",
    risk_reason,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    fileCount: files.length,
    description,
    files,
  };
}

/**
 * Find the real hunk an anchor refers to. Exact match on both starts first;
 * then fall back to new_start, then old_start (LLMs sometimes miscount one
 * side). Only ever returns an unclaimed hunk.
 */
function matchHunk(
  parsed: ParsedFile,
  anchor: { old_start: number; new_start: number },
): ParsedHunk | undefined {
  const free = parsed.hunks.filter((h) => h.claimedBy === -1);
  return (
    free.find((h) => h.oldStart === anchor.old_start && h.newStart === anchor.new_start) ??
    free.find((h) => h.newStart === anchor.new_start) ??
    free.find((h) => h.oldStart === anchor.old_start)
  );
}

export function resolveReview(
  agent: AgentReview,
  rawDiff: string,
  meta: ReviewMeta,
  pr: PrMetadata,
): ResolveResult {
  const warnings: string[] = [];
  const parsedFiles = parseDiff(rawDiff);

  // Lookups keyed by both head and pre-rename paths.
  const byPath = new Map<string, ParsedFile>();
  for (const f of parsedFiles) {
    if (f.path) byPath.set(normalizePath(f.path), f);
    if (f.oldPath) byPath.set(normalizePath(f.oldPath), f);
  }
  const referenced = new Set<ParsedFile>();

  const findFile = (agentPath: string): ParsedFile | undefined => {
    const key = normalizePath(agentPath);
    const hit = byPath.get(key);
    if (hit) return hit;
    // Last-resort basename match (agent occasionally trims a path prefix).
    const base = key.split("/").pop();
    const matches = parsedFiles.filter((f) => f.path.split("/").pop() === base);
    if (matches.length === 1) {
      warnings.push(`Matched agent path "${agentPath}" to "${matches[0]!.path}" by basename.`);
      return matches[0];
    }
    return undefined;
  };

  const chapters: ResolvedChapter[] = [];

  // Defense in depth: chapter indices drive hunk claiming and UI keys. Trust
  // the ORDER the agent chose, not the numbers (dupes/gaps/negatives happen).
  const chaptersInOrder = agent.chapters.map((ch, i) => {
    const index = i + 1;
    if (ch.index !== index) {
      warnings.push(`Chapter "${ch.title}": index ${ch.index} normalized to ${index}.`);
    }
    return { ...ch, index };
  });

  for (const ch of chaptersInOrder) {
    // A path listed more than once in a chapter must yield ONE ResolvedFile with
    // the UNION of claimed hunks — two entries with the same path become duplicate
    // React keys in the viewer and corrupt per-card state. Key by the parsed file
    // object (findFile can map two path spellings to the same file — those merge).
    const claimedByFile = new Map<ParsedFile, Set<ParsedHunk>>();
    const fileOrder: ParsedFile[] = [];

    for (const af of ch.files) {
      const parsed = findFile(af.path);
      if (!parsed) {
        warnings.push(`Chapter ${ch.index}: file "${af.path}" not found in the diff — skipped.`);
        continue;
      }

      let claimed: ParsedHunk[];
      if (!af.hunks || af.hunks.length === 0) {
        // Whole file: claim every still-unclaimed hunk.
        claimed = parsed.hunks.filter((h) => h.claimedBy === -1);
      } else {
        claimed = [];
        for (const anchor of af.hunks) {
          const h = matchHunk(parsed, anchor);
          if (h) claimed.push(h);
          else {
            warnings.push(
              `Chapter ${ch.index}: no unclaimed hunk in "${af.path}" matches anchor ` +
                `(old ${anchor.old_start}, new ${anchor.new_start}).`,
            );
          }
        }
      }
      for (const h of claimed) h.claimedBy = ch.index;

      const anchored = !!af.hunks && af.hunks.length > 0;
      if (anchored && claimed.length === 0) {
        warnings.push(
          `Chapter ${ch.index}: none of the anchors for "${af.path}" matched — ` +
            `its changes will appear under "Unsorted changes".`,
        );
        continue; // no empty entry; unclaimed hunks fall through to Unsorted
      }
      referenced.add(parsed);

      if (!claimedByFile.has(parsed)) {
        claimedByFile.set(parsed, new Set());
        fileOrder.push(parsed);
      }
      const set = claimedByFile.get(parsed)!;
      for (const h of claimed) set.add(h);
    }

    const files: ResolvedFile[] = fileOrder.map((parsed) => {
      const claimedSet = claimedByFile.get(parsed)!;
      return resolvedFileFrom(
        parsed,
        parsed.hunks.filter((h) => claimedSet.has(h)),
      );
    });

    chapters.push({
      index: ch.index,
      title: ch.title,
      risk: ch.risk,
      risk_reason: ch.risk_reason,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      fileCount: files.length,
      description: ch.description,
      files,
    });
  }

  // Step 4 — bucket anything unclaimed so no change is dropped.
  // Noise (lockfiles, images, …) gets its own chapter so it doesn't dilute
  // "Unsorted changes" or fire a resolution warning.
  const unsortedFiles: ResolvedFile[] = [];
  const noiseFiles: ResolvedFile[] = [];
  for (const f of parsedFiles) {
    const leftover = f.hunks.filter((h) => h.claimedBy === -1);
    const neverReferenced = !referenced.has(f);
    if (leftover.length > 0 || (neverReferenced && f.hunks.length === 0)) {
      const resolved = resolvedFileFrom(f, leftover);
      if (isNoiseFile(f.path)) noiseFiles.push(resolved);
      else unsortedFiles.push(resolved);
    }
  }
  let nextIndex = chaptersInOrder.length + 1;
  if (unsortedFiles.length > 0) {
    warnings.push(
      `${unsortedFiles.length} file(s) had changes not grouped into any chapter — ` +
        `bucketed into "${UNSORTED_TITLE}".`,
    );
    chapters.push(
      bucketChapter(
        unsortedFiles,
        nextIndex++,
        UNSORTED_TITLE,
        "Changes the agent did not assign to a chapter.",
        "These changes are present in the diff but were not grouped into a chapter by the agent. " +
          "Review them directly.",
      ),
    );
  }
  if (noiseFiles.length > 0) {
    chapters.push(
      bucketChapter(
        noiseFiles,
        nextIndex,
        NOISE_TITLE,
        "Generated or binary artifacts — not hand-written code.",
        "Lockfiles, minified bundles, snapshots, images, and similar artifacts set aside " +
          "automatically. Included in full so nothing is hidden.",
      ),
    );
  }

  // Overall stats come from the FULL diff (authoritative), not just claimed hunks.
  const stats: ReviewStats = {
    additions: parsedFiles.reduce((n, f) => n + f.additions, 0),
    deletions: parsedFiles.reduce((n, f) => n + f.deletions, 0),
    filesChanged: parsedFiles.length,
  };

  return {
    review: { meta, pr, prologue: agent.prologue, stats, chapters, warnings },
    warnings,
  };
}
