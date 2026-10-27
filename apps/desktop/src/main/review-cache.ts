/**
 * Finished reviews on disk (US-16), so reopening a PR is instant and costs no
 * agent run. One file per PR head, in the app data folder:
 *
 *   <dir>/<owner>/<repo>/<number>@<headSha>.json   the review, the PR's files and SHAs
 *   <dir>/index.json                               what is saved (lists, lookups)
 *
 * File paths are built only from checked parts (owner and repo names, a
 * number, a SHA), never from what the renderer sends: it names a review by
 * its key, which is looked up in the index. A file that is missing or damaged
 * is dropped from the index.
 *
 * No Electron imports: tested with bun.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ResolvedReview } from "@review-buddy/core/types";
import type { SavedReviewInfo } from "../shared/ipc.ts";
import { type DiffFileInfo, isRepoName } from "./github/api-source.ts";

export const CACHE_VERSION = 1;

/** What one review file holds. */
export interface SavedReview {
  version: typeof CACHE_VERSION;
  reviewKey: string;
  /** `owner/repo#123`. */
  pr: string;
  headSha: string;
  /** The merge base: the base side of file reads. */
  baseSha: string;
  savedAt: string;
  /** The diff's files, for file reads after a restart. */
  files: DiffFileInfo[];
  review: ResolvedReview;
}

const SHA = /^[0-9a-f]{40}$/;

/** The key a review of `pr` at `headSha` has in the app (and in the viewer's local state). */
export function reviewKeyOf(pr: string, headSha: string): string {
  return `${pr}@${headSha.slice(0, 12)}`;
}

/** `owner/repo#123` → its parts, or null if any part is not safe in a path. */
export function parseLabel(pr: string): { owner: string; repo: string; number: number } | null {
  const m = /^([^/#]+)\/([^/#]+)#(\d{1,9})$/.exec(pr);
  if (!m || !isRepoName(m[1]!) || !isRepoName(m[2]!)) return null;
  const number = Number(m[3]);
  return number >= 1 ? { owner: m[1]!, repo: m[2]!, number } : null;
}

export class ReviewCache {
  #index = new Map<string, SavedReviewInfo>();
  /** One index write at a time. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Reads the index; entries whose file is gone are dropped. */
  async load(): Promise<void> {
    let entries: unknown;
    try {
      entries = JSON.parse(await readFile(join(this.dir, "index.json"), "utf8"));
    } catch {
      return; // none yet, or damaged: start empty
    }
    if (!Array.isArray(entries)) return;
    for (const value of entries) {
      const info = toInfo(value);
      if (!info) continue;
      try {
        await stat(this.#file(info.pr, info.headSha)!);
        this.#index.set(info.reviewKey, info);
      } catch {
        // The file is gone.
      }
    }
  }

  /** Newest first. */
  list(): SavedReviewInfo[] {
    return [...this.#index.values()]
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .map((info) => ({ ...info }));
  }

  /** The newest saved review of `owner/repo#123` (any case), at whatever head. */
  newestFor(pr: string): { reviewKey: string; headSha: string; doneAt?: string } | undefined {
    const found = this.list().find((info) => info.pr.toLowerCase() === pr.toLowerCase());
    if (!found) return undefined;
    const { reviewKey, headSha, doneAt } = found;
    return doneAt ? { reviewKey, headSha, doneAt } : { reviewKey, headSha };
  }

  /** The saved review of `pr` at exactly `headSha`. */
  find(pr: string, headSha: string): string | undefined {
    const key = reviewKeyOf(pr, headSha);
    const found = [...this.#index.values()].find(
      (info) => info.reviewKey.toLowerCase() === key.toLowerCase() && info.headSha === headSha,
    );
    return found?.reviewKey;
  }

  /** The saved review, or undefined (unknown, missing or damaged: then it is dropped). */
  async read(reviewKey: unknown): Promise<SavedReview | undefined> {
    const info = typeof reviewKey === "string" ? this.#index.get(reviewKey) : undefined;
    if (!info) return undefined;
    try {
      const saved = JSON.parse(
        await readFile(this.#file(info.pr, info.headSha)!, "utf8"),
      ) as SavedReview;
      // Deleted (or saved again) while the file was read.
      if (this.#index.get(info.reviewKey) !== info) return undefined;
      if (
        saved?.version === CACHE_VERSION &&
        saved.reviewKey === info.reviewKey &&
        saved.headSha === info.headSha &&
        SHA.test(saved.baseSha) &&
        Array.isArray(saved.files) &&
        saved.review &&
        Array.isArray(saved.review.chapters)
      ) {
        return saved;
      }
    } catch {
      // Missing or not JSON.
    }
    await this.delete(info.reviewKey);
    return undefined;
  }

  /** Saves a review (a second review of the same PR head replaces the first). */
  async save(entry: Omit<SavedReview, "version" | "savedAt" | "reviewKey">): Promise<string> {
    const file = this.#file(entry.pr, entry.headSha);
    if (!file || !SHA.test(entry.baseSha)) throw new Error(`Cannot save a review of ${entry.pr}.`);
    const reviewKey = reviewKeyOf(entry.pr, entry.headSha);
    const saved: SavedReview = {
      version: CACHE_VERSION,
      reviewKey,
      savedAt: this.now().toISOString(),
      ...entry,
    };
    const text = JSON.stringify(saved);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, text);
    await rename(`${file}.tmp`, file);
    // The review it replaces: the same PR head, maybe another spelling (owner/repo case).
    let doneAt: string | undefined;
    for (const [key, info] of this.#index) {
      if (key.toLowerCase() === reviewKey.toLowerCase()) {
        doneAt ??= info.doneAt;
        this.#index.delete(key);
      }
    }
    const info: SavedReviewInfo = {
      reviewKey,
      pr: entry.pr,
      title: entry.review.pr.title,
      headSha: entry.headSha,
      savedAt: saved.savedAt,
      bytes: Buffer.byteLength(text),
    };
    // Done belongs to the commit, like the viewed files: a new review of the
    // same head only replaces Claude's text.
    if (doneAt) info.doneAt = doneAt;
    this.#index.set(reviewKey, info);
    await this.#writeIndex();
    return reviewKey;
  }

  /** The reviewer pressed Done (US-17); false if the review is not saved. */
  async markDone(reviewKey: string, doneAt: string): Promise<boolean> {
    const info = this.#index.get(reviewKey);
    if (!info) return false;
    info.doneAt = doneAt;
    await this.#writeIndex();
    return true;
  }

  /** Deletes one saved review; false if it was not saved. */
  async delete(reviewKey: unknown): Promise<boolean> {
    const info = typeof reviewKey === "string" ? this.#index.get(reviewKey) : undefined;
    if (!info) return false;
    this.#index.delete(info.reviewKey);
    await rm(this.#file(info.pr, info.headSha)!, { force: true });
    await this.#writeIndex();
    return true;
  }

  async deleteAll(): Promise<void> {
    this.#index.clear();
    await this.#run(() => rm(this.dir, { recursive: true, force: true }));
  }

  /** `<dir>/<owner>/<repo>/<number>@<headSha>.json`, or null for unsafe parts. */
  #file(pr: string, headSha: string): string | null {
    const parts = parseLabel(pr);
    if (!parts || !SHA.test(headSha)) return null;
    // Lower case: GitHub names are case-insensitive, and so are some file systems.
    return join(
      this.dir,
      parts.owner.toLowerCase(),
      parts.repo.toLowerCase(),
      `${parts.number}@${headSha}.json`,
    );
  }

  #writeIndex(): Promise<void> {
    return this.#run(async () => {
      await mkdir(this.dir, { recursive: true });
      const file = join(this.dir, "index.json");
      await writeFile(`${file}.tmp`, `${JSON.stringify([...this.#index.values()], null, 1)}\n`);
      await rename(`${file}.tmp`, file);
    });
  }

  #run<T>(step: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(step, step);
    this.#queue = next.catch(() => {});
    return next;
  }
}

/** An index entry from disk, checked, or null. */
function toInfo(value: unknown): SavedReviewInfo | null {
  const v = value as Partial<SavedReviewInfo> | null;
  if (
    !v ||
    typeof v.reviewKey !== "string" ||
    typeof v.pr !== "string" ||
    !parseLabel(v.pr) ||
    typeof v.headSha !== "string" ||
    !SHA.test(v.headSha) ||
    v.reviewKey !== reviewKeyOf(v.pr, v.headSha) ||
    typeof v.savedAt !== "string"
  ) {
    return null;
  }
  const info: SavedReviewInfo = {
    reviewKey: v.reviewKey,
    pr: v.pr,
    title: typeof v.title === "string" ? v.title : v.pr,
    headSha: v.headSha,
    savedAt: v.savedAt,
    bytes: typeof v.bytes === "number" ? v.bytes : 0,
  };
  if (typeof v.doneAt === "string") info.doneAt = v.doneAt;
  return info;
}
