/**
 * The app's agent reviews (US-12, US-14): a queue of jobs, run one after
 * another in start order. Each job parses the PR, opens it, runs the agent,
 * and adds the result to the ReviewStore so the viewer can load it. The
 * renderer polls `jobs()`.
 *
 * No Electron imports: tested with bun.
 */
import type { ReviewJobStatus } from "../../shared/ipc.ts";
import type { GitHubApiSource, PrRef } from "../github/api-source.ts";
import { parsePrArg } from "../github/pr-check.ts";
import type { ReviewStore } from "../reviews.ts";
import type { ReviewRunResult } from "./runner.ts";

const MAX_STEPS = 50;

export interface ReviewJobDeps {
  store: ReviewStore;
  /** `signal` stops the PR's GitHub requests when the user stops the run. */
  open(ref: PrRef, signal: AbortSignal): Promise<GitHubApiSource>;
  run(
    source: GitHubApiSource,
    label: string,
    onProgress: (step: string) => void,
    signal: AbortSignal,
  ): Promise<ReviewRunResult>;
  /** One line per finished run (the app logs it to the console). */
  log?(line: string): void;
}

/** Finished jobs kept for the renderer; queued and running ones are always kept. */
export const MAX_FINISHED = 20;

interface Job {
  status: ReviewJobStatus;
  ref: PrRef;
  abort: AbortController;
}

export class ReviewJobs {
  #jobs: Job[] = [];
  #nextId = 1;
  /** The running job's promise; the next job starts when it settles. */
  #active: Promise<void> | undefined;

  constructor(private readonly deps: ReviewJobDeps) {}

  jobs(): ReviewJobStatus[] {
    return this.#jobs.map((job) => structuredClone(job.status));
  }

  /**
   * Queues a review of `value` ("owner/repo#123" or a PR URL). It runs when
   * the jobs before it are done.
   */
  start(value: unknown): ReviewJobStatus {
    if (typeof value !== "string") throw new Error("Expected a PR reference.");
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
    };
    this.#jobs.push(job);
    this.#prune();
    this.#next();
    return structuredClone(job.status);
  }

  /**
   * Stops a running job, or takes a queued one out of the queue (it ends as
   * "Stopped."). A finished job is kept as it is (its file reads still work).
   */
  stop(id: unknown): ReviewJobStatus[] {
    const job = this.#jobs.find((j) => j.status.id === id);
    if (job?.status.state === "queued") {
      job.status = { ...job.status, state: "failed", error: "Stopped." };
    } else if (job?.status.state === "running") {
      job.abort.abort();
    }
    return this.jobs();
  }

  /** Stops everything (the app quits). */
  stopAll(): void {
    for (const job of this.#jobs) {
      if (job.status.state === "queued") {
        job.status = { ...job.status, state: "failed", error: "Stopped." };
      }
    }
    for (const job of this.#jobs) if (job.status.state === "running") job.abort.abort();
  }

  /** Resolves when no job is queued or running. */
  async whenIdle(): Promise<void> {
    while (this.#active) await this.#active;
  }

  /** Starts the oldest queued job if none is running. */
  #next(): void {
    if (this.#active) return;
    const job = this.#jobs.find((j) => j.status.state === "queued");
    if (!job) return;
    job.status = { ...job.status, state: "running" };
    this.#active = this.#run(job).finally(() => {
      this.#active = undefined;
      this.#next();
    });
  }

  /** Drops the oldest finished jobs beyond MAX_FINISHED. */
  #prune(): void {
    let finished = this.#jobs.filter((j) => !isActive(j.status)).length;
    this.#jobs = this.#jobs.filter((j) => isActive(j.status) || finished-- <= MAX_FINISHED);
  }

  async #run(job: Job): Promise<void> {
    const { ref, abort } = job;
    const { signal } = abort;
    const label = job.status.pr;
    const onProgress = (step: string) => {
      job.status.steps = [...job.status.steps, step].slice(-MAX_STEPS);
    };
    let result: ReviewRunResult;
    let reviewKey: string | undefined;
    try {
      const source = await this.deps.open(ref, signal);
      if (signal.aborted) throw new Error("stopped");
      job.status.headSha = source.headSha;
      result = await this.deps.run(source, label, onProgress, signal);
      // Stopped means stopped, even after a submission: the user asked for no review.
      if (result.review && !signal.aborted) {
        // Viewed-file flags are kept per PR head: a new push is a new review.
        reviewKey = `${label}@${source.headSha.slice(0, 12)}`;
        this.deps.store.add(reviewKey, result.review, source, { label, headSha: source.headSha });
      }
    } catch (e) {
      result = {
        ok: false,
        warnings: [],
        submissions: 0,
        durationMs: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    job.status = reviewKey
      ? { ...job.status, state: "done", reviewKey, notes: result.warnings }
      : {
          ...job.status,
          state: "failed",
          error: signal.aborted ? "Stopped." : (result.error ?? "The review failed."),
        };
    this.#prune();
    const { review: _review, ...summary } = result;
    this.deps.log?.(JSON.stringify({ pr: label, ...summary, warnings: result.warnings.length }));
  }
}

function isActive(status: ReviewJobStatus): boolean {
  return status.state === "queued" || status.state === "running";
}
