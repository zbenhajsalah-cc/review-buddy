import { expect, test } from "bun:test";
import type { ReviewJobStatus } from "../../shared/ipc.ts";
import { jobToFollow, viewForEndedJob } from "./open-job.ts";

const job = (id: number, more: Partial<ReviewJobStatus> = {}): ReviewJobStatus => ({
  id,
  pr: `octo/repo#${id}`,
  state: "done",
  steps: [],
  reviewKey: `octo/repo#${id}@abc`,
  ...more,
});

test("a notification click shows the job while the list keeps it", () => {
  expect(viewForEndedJob([job(1), job(2)], job(1))).toEqual({ kind: "job", id: 1 });
});

test("a job the list dropped shows its saved review; a failed one, nothing", () => {
  expect(viewForEndedJob([job(30)], job(1))).toEqual({
    kind: "review",
    reviewKey: "octo/repo#1@abc",
    pr: "octo/repo#1",
  });
  const failed = job(2, { state: "failed", reviewKey: undefined, error: "No." });
  expect(viewForEndedJob([job(30)], failed)).toBeNull();
});

test("a new page follows the job in ?job=, else the newest", () => {
  const jobs = [job(1), job(2), job(3)];
  expect(jobToFollow(jobs, "?job=2")?.id).toBe(2);
  expect(jobToFollow(jobs, "")?.id).toBe(3);
  expect(jobToFollow(jobs, "?job=9")?.id).toBe(3); // gone: the newest
  expect(jobToFollow([], "?job=2")).toBeUndefined();
});
