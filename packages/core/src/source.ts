/**
 * Where a review's bytes come from (sources B + C — see CLAUDE.md "The three
 * data sources"). One interface, several backends: the plugin reads the local
 * repo (node/local-source.ts); the desktop app will read the GitHub API.
 */
import type { PrMetadata } from "./types.ts";

export interface ReviewDataSource {
  /** The authoritative unified diff (source B) that resolveReview parses. */
  diff(): Promise<string>;
  /** PR metadata (source B). */
  pr(): Promise<PrMetadata>;
  /**
   * Full file bytes at one side of the diff (source C), for expansion and
   * word-level highlighting. "" means unavailable — callers must not render it
   * as an empty file. Callers restrict `path` to the review's files
   * (allowedPaths) before asking.
   */
  fileContent(path: string, side: "base" | "head"): Promise<string>;
}
