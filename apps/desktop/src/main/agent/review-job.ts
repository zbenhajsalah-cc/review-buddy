/**
 * The app's one agent review at a time (US-12): parses the PR the renderer
 * asks for, opens it, runs the agent, and adds the result to the ReviewStore
 * so the viewer can load it. The renderer polls `status()`.
 *
 * No Electron imports: tested with bun.
 */
import type { ReviewRunStatus } from "../../shared/ipc.ts";
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

export class ReviewJob {
  #status: ReviewRunStatus = { run: 0, state: "idle", steps: [] };
  #abort: AbortController | undefined;
  #running: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ReviewJobDeps) {}

  status(): ReviewRunStatus {
    return structuredClone(this.#status);
  }

  /** Starts a review of `value` ("owner/repo#123" or a PR URL). */
  start(value: unknown): ReviewRunStatus {
    if (this.#status.state === "running") throw new Error("A review is already running.");
    if (typeof value !== "string") throw new Error("Expected a PR reference.");
    const ref = parsePrArg(value); // throws a message for the user
    const label = `${ref.owner}/${ref.repo}#${ref.number}`;
    const abort = new AbortController();
    this.#abort = abort;
    const run = this.#status.run + 1;
    this.#status = { run, state: "running", pr: label, steps: [] };
    this.#running = this.#run(run, ref, label, abort.signal);
    return this.status();
  }

  /** Stops the running review. A finished one is kept (its file reads still work). */
  stop(): ReviewRunStatus {
    if (this.#status.state === "running") this.#abort?.abort();
    return this.status();
  }

  /** Resolves when the current run (if any) has finished. */
  whenIdle(): Promise<void> {
    return this.#running;
  }

  async #run(run: number, ref: PrRef, label: string, signal: AbortSignal): Promise<void> {
    const onProgress = (step: string) => {
      if (this.#status.run !== run) return;
      this.#status.steps = [...this.#status.steps, step].slice(-MAX_STEPS);
    };
    let result: ReviewRunResult;
    let reviewKey: string | undefined;
    try {
      const source = await this.deps.open(ref, signal);
      if (signal.aborted) throw new Error("stopped");
      result = await this.deps.run(source, label, onProgress, signal);
      // Stopped means stopped, even after a submission: the user asked for no review.
      if (result.review && !signal.aborted) {
        // Viewed-file flags are kept per PR head: a new push is a new review.
        reviewKey = `${label}@${source.headSha.slice(0, 12)}`;
        this.deps.store.add(reviewKey, result.review, source);
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
    this.#status = reviewKey
      ? { ...this.#status, state: "done", reviewKey, notes: result.warnings }
      : {
          ...this.#status,
          state: "failed",
          error: signal.aborted ? "Stopped." : (result.error ?? "The review failed."),
        };
    if (this.#abort?.signal === signal) this.#abort = undefined;
    const { review: _review, ...summary } = result;
    this.deps.log?.(JSON.stringify({ pr: label, ...summary, warnings: result.warnings.length }));
  }
}
