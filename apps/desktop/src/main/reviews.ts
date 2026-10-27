/**
 * The reviews main can serve to the renderer, keyed by review key. Every IPC
 * argument comes from the renderer, which shows untrusted PR and agent text,
 * so it is checked here before use. No Electron imports: tested with bun.
 */
import { languageOf } from "@review-buddy/core/diff";
import { allowedPaths } from "@review-buddy/core/resolve";
import type { ReviewDataSource } from "@review-buddy/core/source";
import type { ResolvedReview } from "@review-buddy/core/types";
import type { FileSide, IpcDoneResult, IpcFileContent } from "../shared/ipc.ts";

// A verdict summary is short prose; anything larger is malformed (same limit
// as the plugin's /api/done).
const MAX_SUMMARY = 256 * 1024;

interface LoadedReview {
  review: ResolvedReview;
  source: ReviewDataSource;
  /** Only the review's own files may be read (source C). */
  allowed: Set<string>;
}

export class ReviewStore {
  #reviews = new Map<string, LoadedReview>();
  /** The newest review of each PR, by lower-case `owner/repo#123`. */
  #newest = new Map<string, { reviewKey: string; headSha: string }>();

  /** `pr`: the PR and head the review is for, so the PR list can show it. */
  add(
    reviewKey: string,
    review: ResolvedReview,
    source: ReviewDataSource,
    pr?: { label: string; headSha: string },
  ): void {
    this.#reviews.set(reviewKey, { review, source, allowed: allowedPaths(review) });
    if (pr) this.#newest.set(pr.label.toLowerCase(), { reviewKey, headSha: pr.headSha });
  }

  /** The newest review of `owner/repo#123`, at whatever head it had. */
  newestFor(label: string): { reviewKey: string; headSha: string } | undefined {
    const found = this.#newest.get(label.toLowerCase());
    return found && { ...found };
  }

  getReview(reviewKey: unknown): ResolvedReview {
    return this.#get(reviewKey).review;
  }

  async getFileContent(reviewKey: unknown, path: unknown, side: unknown): Promise<IpcFileContent> {
    const loaded = this.#get(reviewKey);
    if (typeof path !== "string" || !loaded.allowed.has(path)) {
      throw new Error("unknown path");
    }
    const s: FileSide = side === "base" ? "base" : "head";
    const content = await loaded.source.fileContent(path, s);
    return { path, side: s, language: languageOf(path), content };
  }

  #get(reviewKey: unknown): LoadedReview {
    const loaded = typeof reviewKey === "string" ? this.#reviews.get(reviewKey) : undefined;
    if (!loaded) throw new Error("unknown review");
    return loaded;
  }
}

/** Checks a `done` payload from the renderer and keeps only the known fields. */
export function parseDoneResult(value: unknown): IpcDoneResult {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object") throw new Error("invalid done result");
  const { verdict, summary } = value as Record<string, unknown>;
  const result: IpcDoneResult = {};
  if (verdict !== undefined) {
    if (verdict !== "approve" && verdict !== "request_changes") throw new Error("invalid verdict");
    result.verdict = verdict;
  }
  if (summary !== undefined) {
    if (typeof summary !== "string" || summary.length > MAX_SUMMARY) {
      throw new Error("invalid summary");
    }
    result.summary = summary;
  }
  return result;
}
