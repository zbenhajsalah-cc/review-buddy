/**
 * The app's agent reviews (US-12, US-14, US-15): a queue of jobs, at most
 * `maxRunning` at once (2 by default), started in start order. Each job
 * parses the PR, opens it, runs the agent, and adds the result to the
 * ReviewStore (which saves it) so the viewer can load it. A PR whose current
 * head already has a saved review opens that one, without Claude, unless the
 * job asks for a fresh run (US-16). Every change (a new job, a step, an
 * end) calls `onChange`; main sends the list to the renderer.
 *
 * No Electron imports: tested with bun.
 */
import type { ReviewJobStatus } from "../../shared/ipc.ts";
import { type GitHubApiSource, type PrRef, PrTooLargeError } from "../github/api-source.ts";
import { parsePrArg } from "../github/pr-check.ts";
import type { ReviewStore } from "../reviews.ts";
import type { ReviewProgress, ReviewRunResult } from "./runner.ts";

const MAX_STEPS = 50;
/** Reviews that run at the same time: each is a Claude Code process. */
export const MAX_RUNNING = 2;

export interface ReviewJobDeps {
  store: ReviewStore;
  /** `signal` stops the PR's GitHub requests when the user stops the run. */
  open(ref: PrRef, signal: AbortSignal): Promise<GitHubApiSource>;
  run(
    source: GitHubApiSource,
    label: string,
    onProgress: (progress: ReviewProgress) => void,
    signal: AbortSignal,
  ): Promise<ReviewRunResult>;
  /** One line per finished run (the app logs it to the console). */
  log?(line: string): void;
  /** The job list changed. */
  onChange?(): void;
  maxRunning?: number;
  now?: () => number;
}

/** Finished jobs kept for the renderer; queued and running ones are always kept. */
export const MAX_FINISHED = 20;

interface Job {
  status: ReviewJobStatus;
  ref: PrRef;
  abort: AbortController;
  /** Run the agent even if a review of this head is saved. */
  fresh: boolean;
}

export class ReviewJobs {
  #jobs: Job[] = [];
  #nextId = 1;
  /** The running jobs' promises; a queued job starts when one settles. */
  #active = new Set<Promise<void>>();

  constructor(private readonly deps: ReviewJobDeps) {}

  jobs(): ReviewJobStatus[] {
    return this.#jobs.map((job) => structuredClone(job.status));
  }

  /**
   * Queues a review of `value` ("owner/repo#123" or a PR URL). It runs as
   * soon as fewer than `maxRunning` jobs run.
   */
  start(value: unknown, options?: unknown): ReviewJobStatus {
    if (typeof value !== "string") throw new Error("Expected a PR reference.");
    const fresh = (options as { fresh?: unknown } | undefined)?.fresh === true;
    const ref = parsePrArg(value); // throws a message for the user
    const pr = `${ref.owner}/${ref.repo}#${ref.number}`;
    const same = this.#jobs.find(
      (j) => isActive(j.status) && j.status.pr.toLowerCase() === pr.toLowerCase(),
    );
    if (same) {
      throw new Error(
        `${same.status.pr} is already ${same.status.state === "running" ? "being reviewed" : "in the queue"}.`,
      );
    }
    const job: Job = {
      status: { id: this.#nextId++, pr, state: "queued", steps: [] },
      ref,
      abort: new AbortController(),
      fresh,
    };
    this.#jobs.push(job);
    this.#prune();
    this.#next();
    this.#changed();
    return structuredClone(job.status);
  }

  /**
   * Stops a running job, or takes a queued one out of the queue (it ends as
   * "Stopped."). A finished job is kept as it is (its file reads still work).
   */
  stop(id: unknown): ReviewJobStatus[] {
    const job = this.#jobs.find((j) => j.status.id === id);
    if (job?.status.state === "queued") {
      this.#unqueue(job);
      this.#changed();
    } else if (job?.status.state === "running") {
      job.abort.abort();
    }
    return this.jobs();
  }

  /** Stops everything (the app quits). */
  stopAll(): void {
    for (const job of this.#jobs) if (job.status.state === "queued") this.#unqueue(job);
    for (const job of this.#jobs) if (job.status.state === "running") job.abort.abort();
    this.#changed();
  }

  /**
   * A saved review was deleted (all of them without a key): finished jobs
   * that show it are dropped, so nothing offers to open it.
   */
  forgetReview(reviewKey?: unknown): void {
    const before = this.#jobs.length;
    // Keys differ only in case for the same PR head (owner/repo as typed).
    const key = typeof reviewKey === "string" ? reviewKey.toLowerCase() : reviewKey;
    this.#jobs = this.#jobs.filter(
      (j) =>
        j.status.state !== "done" ||
        (key !== undefined && j.status.reviewKey?.toLowerCase() !== key),
    );
    if (this.#jobs.length !== before) this.#changed();
  }

  /** Resolves when no job is queued or running. */
  async whenIdle(): Promise<void> {
    while (this.#active.size) await Promise.all(this.#active);
  }

  /** Starts the oldest queued jobs while a slot is free. */
  #next(): void {
    const max = this.deps.maxRunning ?? MAX_RUNNING;
    while (this.#active.size < max) {
      const job = this.#jobs.find((j) => j.status.state === "queued");
      if (!job) return;
      job.status = { ...job.status, state: "running", phase: "github", startedAt: this.#now() };
      const running: Promise<void> = this.#run(job).finally(() => {
        this.#active.delete(running);
        this.#next();
        this.#changed();
      });
      this.#active.add(running);
    }
  }

  #unqueue(job: Job): void {
    job.status = { ...job.status, state: "failed", error: "Stopped.", errorKind: "stopped" };
  }

  /** Drops the oldest finished jobs beyond MAX_FINISHED. */
  #prune(): void {
    let finished = this.#jobs.filter((j) => !isActive(j.status)).length;
    this.#jobs = this.#jobs.filter((j) => isActive(j.status) || finished-- <= MAX_FINISHED);
  }

  #changed(): void {
    this.deps.onChange?.();
  }

  #now(): number {
    return (this.deps.now ?? Date.now)();
  }

  async #run(job: Job): Promise<void> {
    const { ref, abort } = job;
    const { signal } = abort;
    const label = job.status.pr;
    const onProgress = ({ phase, step }: ReviewProgress) => {
      job.status.phase = phase;
      job.status.steps = [...job.status.steps, step].slice(-MAX_STEPS);
      this.#changed();
    };
    let result: ReviewRunResult;
    let reviewKey: string | undefined;
    try {
      let source: GitHubApiSource;
      try {
        source = await this.deps.open(ref, signal);
      } catch (e) {
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), {
          kind: e instanceof PrTooLargeError ? "too-large" : "github",
        });
      }
      if (signal.aborted) throw new Error("stopped");
      job.status.headSha = source.headSha;
      const saved = job.fresh ? undefined : this.deps.store.find(label, source.headSha);
      if (saved) {
        onProgress({ phase: "checking", step: "Opened the saved review of this commit" });
        reviewKey = saved;
        result = { ok: true, warnings: [], submissions: 0, durationMs: 0, cached: true };
      } else {
        result = await this.deps.run(source, label, onProgress, signal);
        const files = result.review ? await source.files() : [];
        // Stopped means stopped, even after a submission: the user asked for no review.
        if (result.review && !signal.aborted) {
          // Viewed-file flags are kept per PR head: a new push is a new review.
          reviewKey = await this.deps.store.addPrReview(result.review, source, {
            label,
            headSha: source.headSha,
            baseSha: source.baseSha,
            files,
          });
          // Stopped while it was being saved: it is not kept either.
          if (signal.aborted) {
            await this.deps.store.delete(reviewKey).catch(() => {});
            reviewKey = undefined;
          }
        }
      }
    } catch (e) {
      result = {
        ok: false,
        warnings: [],
        submissions: 0,
        durationMs: 0,
        error: e instanceof Error ? e.message : String(e),
        errorKind: (e as { kind?: ReviewRunResult["errorKind"] }).kind ?? "agent",
      };
    }
    const { phase: _phase, ...rest } = job.status;
    job.status = reviewKey
      ? { ...rest, state: "done", reviewKey, notes: result.warnings, endedAt: this.#now() }
      : {
          ...rest,
          state: "failed",
          error: signal.aborted ? "Stopped." : (result.error ?? "The review failed."),
          errorKind: signal.aborted ? "stopped" : (result.errorKind ?? "agent"),
          endedAt: this.#now(),
        };
    this.#prune();
    const { review: _review, ...summary } = result;
    this.deps.log?.(JSON.stringify({ pr: label, ...summary, warnings: result.warnings.length }));
  }
}

function isActive(status: ReviewJobStatus): boolean {
  return status.state === "queued" || status.state === "running";
}
