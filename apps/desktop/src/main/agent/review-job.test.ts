import { describe, expect, test } from "bun:test";
import { loadFixtureReview } from "../fixture/index.ts";
import type { GitHubApiSource, PrRef } from "../github/api-source.ts";
import { ReviewStore } from "../reviews.ts";
import { ReviewJob, type ReviewJobDeps } from "./review-job.ts";

const HEAD = "7e8e70534d5fdb0a8ef1a5a0bf8407774b007b00";

async function setup(run?: ReviewJobDeps["run"]) {
  const { review, source } = await loadFixtureReview();
  const store = new ReviewStore();
  const opened: PrRef[] = [];
  const signals: AbortSignal[] = [];
  const logs: string[] = [];
  const job = new ReviewJob({
    store,
    open: async (ref, signal) => {
      opened.push(ref);
      signals.push(signal);
      return { ...source, ref, headSha: HEAD, baseSha: HEAD } satisfies GitHubApiSource;
    },
    run:
      run ??
      (async (_source, _label, onProgress) => {
        onProgress("Reading the diff");
        return { ok: true, review, warnings: ["a note"], submissions: 1, durationMs: 5 };
      }),
    log: (line) => logs.push(line),
  });
  return { job, store, opened, signals, logs, review };
}

describe("ReviewJob", () => {
  test("a run: running, then done with the review in the store", async () => {
    const { job, store, opened, logs, review } = await setup();
    expect(job.status()).toEqual({ run: 0, state: "idle", steps: [] });
    const started = job.start("https://github.com/octocat/hello-world/pull/42");
    expect(started).toEqual({ run: 1, state: "running", pr: "octocat/hello-world#42", steps: [] });
    await job.whenIdle();
    expect(opened).toEqual([{ owner: "octocat", repo: "hello-world", number: 42 }]);
    const key = "octocat/hello-world#42@7e8e70534d5f";
    expect(job.status()).toEqual({
      run: 1,
      state: "done",
      pr: "octocat/hello-world#42",
      reviewKey: key,
      steps: ["Reading the diff"],
      notes: ["a note"],
    });
    expect(store.getReview(key)).toBe(review);
    expect(JSON.parse(logs[0]!)).toEqual({
      pr: "octocat/hello-world#42",
      ok: true,
      warnings: 1,
      submissions: 1,
      durationMs: 5,
    });
  });

  test("bad input and a second start are refused", async () => {
    let finish = () => {};
    const { job } = await setup(
      (_s, _l, _p, signal) =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: false, warnings: [], submissions: 0, durationMs: 0 });
          signal.addEventListener("abort", finish);
        }),
    );
    expect(() => job.start(42)).toThrow("Expected a PR reference.");
    expect(() => job.start("hello-world#42")).toThrow("Expected owner/repo#123");
    expect(job.status().state).toBe("idle");
    job.start("octocat/hello-world#42");
    expect(() => job.start("octocat/hello-world#43")).toThrow("A review is already running.");
    await Bun.sleep(10); // the fake run starts after the PR is opened
    finish();
    await job.whenIdle();
    expect(job.status()).toMatchObject({ run: 1, state: "failed", error: "The review failed." });
  });

  test("failures and stop end in a failed state with the reason", async () => {
    const { job } = await setup(async () => {
      throw new Error("Not signed in to GitHub.");
    });
    job.start("octocat/hello-world#42");
    await job.whenIdle();
    expect(job.status()).toMatchObject({ state: "failed", error: "Not signed in to GitHub." });

    const stopped = await setup(
      (_s, _l, _p, signal) =>
        new Promise((resolve) =>
          signal.addEventListener("abort", () =>
            resolve({ ok: false, warnings: [], submissions: 0, durationMs: 0, error: "stopped" }),
          ),
        ),
    );
    stopped.job.start("octocat/hello-world#42");
    stopped.job.stop();
    await stopped.job.whenIdle();
    expect(stopped.job.status()).toMatchObject({ state: "failed", error: "Stopped." });
  });

  test("stop after a submission: failed, and the review is not kept", async () => {
    let submitted = () => {};
    const { job, store, review } = await setup(
      (_s, _l, onProgress, signal) =>
        new Promise((resolve) => {
          // The agent has submitted; the run is still going when Stop comes.
          onProgress("Review submitted");
          submitted();
          signal.addEventListener("abort", () =>
            resolve({ ok: true, review, warnings: [], submissions: 1, durationMs: 0 }),
          );
        }),
    );
    const ready = new Promise<void>((r) => {
      submitted = r;
    });
    job.start("octocat/hello-world#42");
    await ready;
    job.stop();
    await job.whenIdle();
    expect(job.status()).toMatchObject({ state: "failed", error: "Stopped." });
    expect(job.status().reviewKey).toBeUndefined();
    expect(() => store.getReview("octocat/hello-world#42@7e8e70534d5f")).toThrow("unknown review");
  });

  test("stop reaches the GitHub requests; stop after the run changes nothing", async () => {
    const { job, signals } = await setup();
    job.start("octocat/hello-world#42");
    job.stop();
    expect(signals[0]!.aborted).toBe(true);
    await job.whenIdle();
    expect(job.status()).toMatchObject({ state: "failed", error: "Stopped." });

    job.start("octocat/hello-world#42");
    await job.whenIdle();
    expect(job.status().state).toBe("done");
    job.stop();
    // The finished review's source still reads files with this signal.
    expect(signals[1]!.aborted).toBe(false);
    expect(job.status().state).toBe("done");
  });

  test("status() is a copy", async () => {
    const { job } = await setup();
    job.start("octocat/hello-world#42");
    job.status().steps.push("tampered");
    await job.whenIdle();
    expect(job.status().steps).toEqual(["Reading the diff"]);
  });
});
