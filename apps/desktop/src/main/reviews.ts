/**
 * The reviews main can serve to the renderer, keyed by review key: the ones
 * in memory (the sample, and every review of this run), then the saved ones
 * (US-16), loaded from disk on first use. Every IPC argument comes from the
 * renderer, which shows untrusted PR and agent text, so it is checked here
 * before use. No Electron imports: tested with bun.
 */
import { languageOf } from "@review-buddy/core/diff";
import { allowedPaths } from "@review-buddy/core/resolve";
import type { ReviewDataSource } from "@review-buddy/core/source";
import type { ResolvedReview } from "@review-buddy/core/types";
import type {
  FileSide,
  IpcDoneResult,
  IpcFileContent,
  PostedReview,
  ReviewEffort,
  SavedReviewInfo,
} from "../shared/ipc.ts";
import type { DiffFileInfo } from "./github/api-source.ts";
import { type ReviewCache, reviewKeyOf, type SavedReview } from "./review-cache.ts";

// A verdict summary is short prose; anything larger is malformed (same limit
// as the plugin's /api/done).
const MAX_SUMMARY = 256 * 1024;

/** Where a review's file bytes come from (source C). */
export type FileSource = Pick<ReviewDataSource, "fileContent">;

/** A PR review as the store keeps (and saves) it. */
export interface PrReview {
  /** `owner/repo#123`. */
  label: string;
  headSha: string;
  baseSha: string;
  files: DiffFileInfo[];
  /** The model that wrote it, as Claude reported it (US-22). */
  model?: string;
  /** The effort the review was asked for (Claude may have lowered it). */
  effort?: ReviewEffort;
}

export interface ReviewStoreOptions {
  /** Saved reviews (US-16). Without it, reviews live until the app quits. */
  cache?: ReviewCache;
  /** File reads for a review loaded from disk. */
  reopen?: (saved: SavedReview) => FileSource;
  /** A save failed (the review still works until the app quits). */
  log?: (line: string) => void;
  now?: () => Date;
}

interface LoadedReview {
  review: ResolvedReview;
  source: FileSource;
  /** Only the review's own files may be read (source C). */
  allowed: Set<string>;
}

export class ReviewStore {
  #reviews = new Map<string, LoadedReview>();
  /** The newest review of each PR in memory, by lower-case `owner/repo#123`. */
  #newest = new Map<string, { reviewKey: string; headSha: string }>();
  /** When the reviewer pressed Done, by review key (US-17). */
  #done = new Map<string, string>();
  /** The PR and head of each PR review of this run, by review key. */
  #prs = new Map<string, { label: string; headSha: string }>();
  /** What each PR review of this run was made with (US-22), by review key. */
  #madeWith = new Map<string, { model?: string; effort?: ReviewEffort }>();
  /** The last review posted to GitHub, by review key (US-20). */
  #posted = new Map<string, PostedReview>();

  constructor(private readonly options: ReviewStoreOptions = {}) {}

  /** A review that is not saved (the sample). */
  add(reviewKey: string, review: ResolvedReview, source: FileSource): void {
    this.#reviews.set(reviewKey, { review, source, allowed: allowedPaths(review) });
  }

  /** A PR review: kept, and saved to disk. Answers with its key. */
  async addPrReview(review: ResolvedReview, source: FileSource, pr: PrReview): Promise<string> {
    const reviewKey = reviewKeyOf(pr.label, pr.headSha);
    this.add(reviewKey, review, source);
    this.#newest.set(pr.label.toLowerCase(), { reviewKey, headSha: pr.headSha });
    this.#prs.set(reviewKey, { label: pr.label, headSha: pr.headSha });
    if (pr.model || pr.effort) {
      this.#madeWith.set(reviewKey, {
        ...(pr.model ? { model: pr.model } : {}),
        ...(pr.effort ? { effort: pr.effort } : {}),
      });
    }
    // Done and the posted review stay with the commit (see ReviewCache.save),
    // whatever the spelling.
    for (const marks of [this.#done, this.#posted] as Map<string, unknown>[]) {
      for (const [key, value] of marks) {
        if (key !== reviewKey && key.toLowerCase() === reviewKey.toLowerCase()) {
          marks.delete(key);
          marks.set(reviewKey, value);
        }
      }
    }
    try {
      await this.options.cache?.save({
        pr: pr.label,
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        files: pr.files,
        review,
        ...(pr.model ? { model: pr.model } : {}),
        ...(pr.effort ? { effort: pr.effort } : {}),
      });
    } catch (e) {
      this.options.log?.(`could not save ${reviewKey}: ${e instanceof Error ? e.message : e}`);
    }
    return reviewKey;
  }

  /**
   * The newest review of `owner/repo#123`, at whatever head it had, when it
   * was done, and the verdict last posted to GitHub.
   */
  newestFor(label: string):
    | {
        reviewKey: string;
        headSha: string;
        doneAt?: string;
        posted?: PostedReview["verdict"];
        model?: string;
        effort?: ReviewEffort;
      }
    | undefined {
    const saved = this.options.cache?.newestFor(label);
    const found = this.#newest.get(label.toLowerCase()) ?? saved;
    if (!found) return undefined;
    const { reviewKey, headSha } = found;
    // This run's, or kept with the saved review of this head.
    const same = saved?.reviewKey.toLowerCase() === reviewKey.toLowerCase();
    const doneAt = this.#done.get(reviewKey) ?? (same ? saved.doneAt : undefined);
    const posted = (this.#posted.get(reviewKey) ?? (same ? saved.posted : undefined))?.verdict;
    // What it was reviewed with: this run's, or kept with the saved review.
    const madeWith =
      this.#madeWith.get(reviewKey) ??
      (same ? { model: saved.model, effort: saved.effort } : undefined);
    return {
      reviewKey,
      headSha,
      ...(doneAt ? { doneAt } : {}),
      ...(posted ? { posted } : {}),
      ...(madeWith?.model ? { model: madeWith.model } : {}),
      ...(madeWith?.effort ? { effort: madeWith.effort } : {}),
    };
  }

  /** The PR and head of a PR review (not the sample), or undefined. */
  prOf(reviewKey: unknown): { label: string; headSha: string } | undefined {
    if (typeof reviewKey !== "string") return undefined;
    const run = this.#prs.get(reviewKey);
    if (run) return run;
    const saved = this.options.cache?.info(reviewKey);
    return saved ? { label: saved.pr, headSha: saved.headSha } : undefined;
  }

  /** The last review posted to GitHub for this one (US-20), or null. */
  posted(reviewKey: unknown): PostedReview | null {
    if (typeof reviewKey !== "string") return null;
    return this.#posted.get(reviewKey) ?? this.options.cache?.info(reviewKey)?.posted ?? null;
  }

  /** A review of this commit was posted to GitHub: kept with the saved review. */
  async markPosted(reviewKey: string, posted: PostedReview): Promise<void> {
    this.#posted.set(reviewKey, posted);
    try {
      await this.options.cache?.markPosted(reviewKey, posted);
    } catch (e) {
      this.options.log?.(
        `could not save the posted review for ${reviewKey}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * The reviewer pressed Done (US-17): kept with the saved review, so the PR
   * list shows it after a restart. The sample review is not saved. Answers
   * with the time.
   */
  async markDone(reviewKey: unknown): Promise<string> {
    await this.#get(reviewKey); // unknown review → error
    const key = reviewKey as string;
    const doneAt = (this.options.now ?? (() => new Date()))().toISOString();
    this.#done.set(key, doneAt);
    try {
      await this.options.cache?.markDone(key, doneAt);
    } catch (e) {
      this.options.log?.(`could not save Done for ${key}: ${e instanceof Error ? e.message : e}`);
    }
    return doneAt;
  }

  /** The review of `owner/repo#123` at exactly this head, if the app has one. */
  find(label: string, headSha: string): string | undefined {
    const inMemory = this.#newest.get(label.toLowerCase());
    if (inMemory?.headSha === headSha) return inMemory.reviewKey;
    return this.options.cache?.find(label, headSha);
  }

  async getReview(reviewKey: unknown): Promise<ResolvedReview> {
    return (await this.#get(reviewKey)).review;
  }

  async getFileContent(reviewKey: unknown, path: unknown, side: unknown): Promise<IpcFileContent> {
    const loaded = await this.#get(reviewKey);
    if (typeof path !== "string" || !loaded.allowed.has(path)) {
      throw new Error("unknown path");
    }
    const s: FileSide = side === "base" ? "base" : "head";
    const content = await loaded.source.fileContent(path, s);
    return { path, side: s, language: languageOf(path), content };
  }

  /** The saved reviews, newest first. */
  saved(): SavedReviewInfo[] {
    return this.options.cache?.list() ?? [];
  }

  /** Forgets a PR review, in memory and on disk. */
  async delete(reviewKey: unknown): Promise<void> {
    if (typeof reviewKey !== "string") throw new Error("unknown review");
    this.#forget(reviewKey);
    await this.options.cache?.delete(reviewKey);
  }

  /** Forgets every PR review (the sample stays). */
  async deleteAll(): Promise<void> {
    for (const { reviewKey } of this.#newest.values()) this.#forget(reviewKey);
    for (const info of this.saved()) this.#forget(info.reviewKey);
    await this.options.cache?.deleteAll();
  }

  #forget(reviewKey: string): void {
    // Only PR reviews have a key with "@<sha>"; the sample cannot be deleted.
    if (!reviewKey.includes("@")) throw new Error("unknown review");
    // Keys that differ only in case are the same PR head (owner/repo as
    // typed): the disk keeps one of them, memory may have both.
    const same = (key: string) => key.toLowerCase() === reviewKey.toLowerCase();
    for (const key of [...this.#reviews.keys()]) if (same(key)) this.#reviews.delete(key);
    for (const marks of [this.#done, this.#prs, this.#posted, this.#madeWith] as Map<
      string,
      unknown
    >[]) {
      for (const key of [...marks.keys()]) if (same(key)) marks.delete(key);
    }
    for (const [label, newest] of this.#newest) {
      if (same(newest.reviewKey)) this.#newest.delete(label);
    }
  }

  async #get(reviewKey: unknown): Promise<LoadedReview> {
    if (typeof reviewKey !== "string") throw new Error("unknown review");
    const loaded = this.#reviews.get(reviewKey);
    if (loaded) return loaded;
    const saved = await this.options.cache?.read(reviewKey);
    if (!saved || !this.options.reopen) throw new Error("unknown review");
    const source = this.options.reopen(saved);
    this.add(reviewKey, saved.review, source);
    return this.#reviews.get(reviewKey)!;
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
