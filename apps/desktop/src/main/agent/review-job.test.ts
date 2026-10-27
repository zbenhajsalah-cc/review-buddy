import { describe, expect, test } from "bun:test";
import { loadFixtureReview } from "../fixture/index.ts";
import type { GitHubApiSource, PrRef } from "../github/api-source.ts";
import { ReviewStore } from "../reviews.ts";
import { MAX_FINISHED, type ReviewJobDeps, ReviewJobs } from "./review-job.ts";
import type { ReviewRunResult } from "./runner.ts";

const HEAD = "7e8e70534d5fdb0a8ef1a5a0bf8407774b007b00";
const FAILED: ReviewRunResult = { ok: false, warnings: [], submissions: 0, durationMs: 0 };

async function setup(run?: ReviewJobDeps["run"]) {
  const { review, source } = await loadFixtureReview();
  const store = new ReviewStore();
  const opened: PrRef[] = [];
  const signals: AbortSignal[] = [];
  const logs: string[] = [];
  const jobs = new ReviewJobs({
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
  return { jobs, store, opened, signals, logs, review };
}

/** A run that waits until `release(label)` (or a stop), then fails. */
function heldRuns() {
  const waiting = new Map<string, () => void>();
  const started: string[] = [];
  const run: ReviewJobDeps["run"] = (_s, label, _p, signal) =>
    new Promise((resolve) => {
      started.push(label);
      const done = () => resolve({ ...FAILED, error: `${label} failed` });
      waiting.set(label, done);
      signal.addEventListener("abort", done);
    });
  const whenStarted = async (label: string) => {
    while (!waiting.has(label)) await Bun.sleep(1);
  };
  const release = async (label: string) => {
    await whenStarted(label);
    waiting.get(label)!();
  };
  return { run, started, whenStarted, release };
}

describe("ReviewJobs", () => {
  test("a job: running, then done with the review in the store", async () => {
    const { jobs, store, opened, logs, review } = await setup();
    expect(jobs.jobs()).toEqual([]);
    const started = jobs.start("https://github.com/octocat/hello-world/pull/42");
    // Nothing before it: it runs at once.
    expect(started).toEqual({ id: 1, pr: "octocat/hello-world#42", state: "running", steps: [] });
    await jobs.whenIdle();
    expect(opened).toEqual([{ owner: "octocat", repo: "hello-world", number: 42 }]);
    const key = "octocat/hello-world#42@7e8e70534d5f";
    expect(jobs.jobs()).toEqual([
      {
        id: 1,
        pr: "octocat/hello-world#42",
        state: "done",
        headSha: HEAD,
        reviewKey: key,
        steps: ["Reading the diff"],
        notes: ["a note"],
      },
    ]);
    expect(store.getReview(key)).toBe(review);
    expect(store.newestFor("OctoCat/Hello-World#42")).toEqual({ reviewKey: key, headSha: HEAD });
    expect(JSON.parse(logs[0]!)).toEqual({
      pr: "octocat/hello-world#42",
      ok: true,
      warnings: 1,
      submissions: 1,
      durationMs: 5,
    });
  });

  test("several PRs run one after another, in start order", async () => {
    const held = heldRuns();
    const { jobs } = await setup(held.run);
    jobs.start("octocat/hello-world#1");
    jobs.start("octocat/hello-world#2");
    jobs.start("octocat/hello-world#3");
    expect(jobs.jobs().map((j) => j.state)).toEqual(["running", "queued", "queued"]);
    await held.release("octocat/hello-world#1");
    await held.whenStarted("octocat/hello-world#2");
    expect(held.started).toEqual(["octocat/hello-world#1", "octocat/hello-world#2"]);
    expect(jobs.jobs().map((j) => j.state)).toEqual(["failed", "running", "queued"]);
    await held.release("octocat/hello-world#2");
    await held.release("octocat/hello-world#3");
    await jobs.whenIdle();
    expect(held.started).toEqual([
      "octocat/hello-world#1",
      "octocat/hello-world#2",
      "octocat/hello-world#3",
    ]);
    expect(jobs.jobs().map((j) => [j.id, j.state, j.error])).toEqual([
      [1, "failed", "octocat/hello-world#1 failed"],
      [2, "failed", "octocat/hello-world#2 failed"],
      [3, "failed", "octocat/hello-world#3 failed"],
    ]);
  });

  test("bad input, and a PR already queued or running, are refused", async () => {
    const held = heldRuns();
    const { jobs } = await setup(held.run);
    expect(() => jobs.start(42)).toThrow("Expected a PR reference.");
    expect(() => jobs.start("hello-world#42")).toThrow("Expected owner/repo#123");
    expect(jobs.jobs()).toEqual([]);
    jobs.start("octocat/hello-world#42");
    jobs.start("octocat/hello-world#43");
    expect(() => jobs.start("OctoCat/hello-world#42")).toThrow(
      "octocat/hello-world#42 is already being reviewed.",
    );
    expect(() => jobs.start("https://github.com/octocat/hello-world/pull/43")).toThrow(
      "octocat/hello-world#43 is already in the queue.",
    );
    await held.release("octocat/hello-world#42");
    await held.release("octocat/hello-world#43");
    await jobs.whenIdle();
    // Finished: the same PR can be reviewed again.
    expect(jobs.start("octocat/hello-world#42").id).toBe(3);
    await held.release("octocat/hello-world#42");
    await jobs.whenIdle();
  });

  test("failures end in a failed state with the reason", async () => {
    const { jobs } = await setup(async () => {
      throw new Error("Not signed in to GitHub.");
    });
    jobs.start("octocat/hello-world#42");
    await jobs.whenIdle();
    expect(jobs.jobs()[0]).toMatchObject({ state: "failed", error: "Not signed in to GitHub." });
  });

  test("stop: a running job is stopped; a queued one leaves the queue", async () => {
    const held = heldRuns();
    const { jobs, signals } = await setup(held.run);
    const first = jobs.start("octocat/hello-world#1");
    const second = jobs.start("octocat/hello-world#2");
    const third = jobs.start("octocat/hello-world#3");
    const after = jobs.stop(second.id);
    expect(after.map((j) => [j.state, j.error])).toEqual([
      ["running", undefined],
      ["failed", "Stopped."],
      ["queued", undefined],
    ]);
    await held.whenStarted("octocat/hello-world#1");
    jobs.stop(first.id);
    expect(signals[0]!.aborted).toBe(true);
    await held.release("octocat/hello-world#3");
    await jobs.whenIdle();
    expect(held.started).toEqual(["octocat/hello-world#1", "octocat/hello-world#3"]);
    expect(jobs.jobs().find((j) => j.id === first.id)).toMatchObject({
      state: "failed",
      error: "Stopped.",
    });
    expect(jobs.jobs().find((j) => j.id === third.id)?.error).toBe("octocat/hello-world#3 failed");
    // Unknown ids change nothing.
    expect(jobs.stop(99)).toEqual(jobs.jobs());
    expect(jobs.stop("1")).toEqual(jobs.jobs());
  });

  test("stop after a submission: failed, and the review is not kept", async () => {
    let submitted = () => {};
    const { jobs, store, review } = await setup(
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
    const job = jobs.start("octocat/hello-world#42");
    await ready;
    jobs.stop(job.id);
    await jobs.whenIdle();
    expect(jobs.jobs()[0]).toMatchObject({ state: "failed", error: "Stopped." });
    expect(jobs.jobs()[0]!.reviewKey).toBeUndefined();
    expect(() => store.getReview("octocat/hello-world#42@7e8e70534d5f")).toThrow("unknown review");
    expect(store.newestFor("octocat/hello-world#42")).toBeUndefined();
  });

  test("stop reaches the GitHub requests; stop after the run changes nothing", async () => {
    const { jobs, signals } = await setup();
    const first = jobs.start("octocat/hello-world#42");
    jobs.stop(first.id);
    expect(signals[0]!.aborted).toBe(true);
    await jobs.whenIdle();
    expect(jobs.jobs()[0]).toMatchObject({ state: "failed", error: "Stopped." });

    const second = jobs.start("octocat/hello-world#42");
    await jobs.whenIdle();
    jobs.stop(second.id);
    // The finished review's source still reads files with this signal.
    expect(signals[1]!.aborted).toBe(false);
    expect(jobs.jobs()[1]!.state).toBe("done");
  });

  test("stopAll stops the running job and empties the queue", async () => {
    const held = heldRuns();
    const { jobs } = await setup(held.run);
    jobs.start("octocat/hello-world#1");
    jobs.start("octocat/hello-world#2");
    await held.whenStarted("octocat/hello-world#1");
    jobs.stopAll();
    await jobs.whenIdle();
    expect(held.started).toEqual(["octocat/hello-world#1"]);
    expect(jobs.jobs().map((j) => j.error)).toEqual(["Stopped.", "Stopped."]);
  });

  test("only the last finished jobs are kept", async () => {
    const { jobs } = await setup(async () => FAILED);
    for (let n = 1; n <= MAX_FINISHED + 3; n++) {
      jobs.start(`octocat/hello-world#${n}`);
      await jobs.whenIdle();
    }
    const kept = jobs.jobs();
    expect(kept).toHaveLength(MAX_FINISHED);
    expect(kept[0]!.id).toBe(4);
    expect(kept.at(-1)!.id).toBe(MAX_FINISHED + 3);
  });

  test("jobs() is a copy", async () => {
    const { jobs } = await setup();
    jobs.start("octocat/hello-world#42");
    jobs.jobs()[0]!.steps.push("tampered");
    await jobs.whenIdle();
    expect(jobs.jobs()[0]!.steps).toEqual(["Reading the diff"]);
  });
});
