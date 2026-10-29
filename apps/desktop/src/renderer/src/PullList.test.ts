import { expect, test } from "bun:test";
import type { PullSummary, ReviewJobStatus } from "../../shared/ipc.ts";
import { pullOwnership, pullState, sizeText } from "./PullList.tsx";

const HEAD = "b".repeat(40);
const OLD = "a".repeat(40);
const pull: PullSummary = {
  number: 7,
  title: "Add widgets",
  author: "octocat",
  updatedAt: "2026-10-27T10:00:00Z",
  draft: false,
  url: "https://github.com/octo/repo/pull/7",
  headSha: HEAD,
  requestedReviewers: [],
  labels: [],
};

function job(id: number, state: ReviewJobStatus["state"], extra: Partial<ReviewJobStatus> = {}) {
  return { id, pr: "octo/repo#7", state, steps: [], ...extra } satisfies ReviewJobStatus;
}

test("nothing yet", () => {
  expect(pullState("octo/repo", pull, [job(1, "done", { pr: "octo/repo#8" })])).toEqual({});
});

test("a review from the list: current or outdated", () => {
  const current = { ...pull, review: { reviewKey: "k", headSha: HEAD } };
  expect(pullState("octo/repo", current, [])).toEqual({
    review: { reviewKey: "k", pr: "octo/repo#7", current: true },
  });
  const old = { ...pull, review: { reviewKey: "k", headSha: OLD } };
  expect(pullState("octo/repo", old, []).review?.current).toBe(false);
});

test("a finished job is newer than the list; a job in progress shows", () => {
  const listed = { ...pull, review: { reviewKey: "old", headSha: OLD } };
  const jobs = [
    job(1, "done", { reviewKey: "new", headSha: HEAD }),
    job(2, "running", { pr: "OCTO/repo#7" }),
  ];
  expect(pullState("octo/repo", listed, jobs)).toEqual({
    job: jobs[1],
    review: { reviewKey: "new", pr: "octo/repo#7", current: true },
  });
});

test("the newest job failed: said, unless it was stopped or another one runs", () => {
  expect(pullState("octo/repo", pull, [job(1, "failed", { error: "PR too large" })])).toEqual({
    failed: "PR too large",
  });
  expect(pullState("octo/repo", pull, [job(1, "failed", { error: "Stopped." })])).toEqual({});
  expect(
    pullState("octo/repo", pull, [job(1, "failed", { error: "x" }), job(2, "queued")]).failed,
  ).toBeUndefined();
  // An older failure under a newer review is not shown.
  expect(
    pullState("octo/repo", pull, [
      job(1, "failed", { error: "x" }),
      job(2, "done", { reviewKey: "k", headSha: HEAD }),
    ]).failed,
  ).toBeUndefined();
});

test("Done comes from the list, for the same review only", () => {
  const listed = {
    ...pull,
    review: { reviewKey: "k", headSha: HEAD, doneAt: "2026-10-27T10:00:00Z" },
  };
  expect(pullState("octo/repo", listed, []).review).toEqual({
    reviewKey: "k",
    pr: "octo/repo#7",
    current: true,
    doneAt: "2026-10-27T10:00:00Z",
  });
  // A newer review (from a job) is not done yet.
  const newer = pullState("octo/repo", listed, [
    job(1, "done", { reviewKey: "k2", headSha: HEAD }),
  ]);
  expect(newer.review?.doneAt).toBeUndefined();
});

test("sizeText", () => {
  expect(sizeText(undefined)).toBe("");
  expect(sizeText({ additions: 120, deletions: 30, changedFiles: 5 })).toBe("+120 −30 · 5 files");
  expect(sizeText({ additions: 1, deletions: 0, changedFiles: 1 })).toBe("+1 −0 · 1 file");
});

test("the posted verdict comes from the list, for the same review only (US-20)", () => {
  const listed = {
    ...pull,
    review: { reviewKey: "k", headSha: HEAD, doneAt: "2026-10-27T10:00:00Z", posted: "approve" },
  } satisfies PullSummary;
  expect(pullState("octo/repo", listed, []).review?.posted).toBe("approve");
  const newer = pullState("octo/repo", listed, [
    job(1, "done", { reviewKey: "k2", headSha: HEAD }),
  ]);
  expect(newer.review?.posted).toBeUndefined();
});

test("a PR is the user's own, or waits on their review (US-14)", () => {
  expect(pullOwnership(pull, "octocat")).toEqual({ mine: true, reviewRequested: false });
  // GitHub's logins are case-insensitive.
  expect(pullOwnership(pull, "OctoCat").mine).toBe(true);
  expect(pullOwnership(pull, "zied")).toEqual({ mine: false, reviewRequested: false });

  const asked = { ...pull, author: "someone", requestedReviewers: ["Zied", "other"] };
  expect(pullOwnership(asked, "zied")).toEqual({ mine: false, reviewRequested: true });
  expect(pullOwnership(asked, "other").reviewRequested).toBe(true);
  expect(pullOwnership(asked, "nobody").reviewRequested).toBe(false);

  // A PR can be both: the user opened it and someone asked them to review it.
  expect(pullOwnership({ ...pull, requestedReviewers: ["octocat"] }, "octocat")).toEqual({
    mine: true,
    reviewRequested: true,
  });

  // Signed out: no login to compare with, so no badge.
  expect(pullOwnership(asked, undefined)).toEqual({ mine: false, reviewRequested: false });
  expect(pullOwnership(asked, "")).toEqual({ mine: false, reviewRequested: false });
});

test("what a review was made with follows the review shown (US-22)", () => {
  const listed = {
    ...pull,
    review: { reviewKey: "k", headSha: HEAD, model: "claude-sonnet-5", effort: "low" },
  } satisfies PullSummary;
  expect(pullState("octo/repo", listed, []).review).toMatchObject({
    model: "claude-sonnet-5",
    effort: "low",
  });
  // Run again finished in this run: the row shows that job's model, not the
  // one the PR page was read with.
  const again = pullState("octo/repo", listed, [
    job(1, "done", { reviewKey: "k2", headSha: HEAD, model: "claude-haiku-5", effort: "max" }),
  ]);
  expect(again.review).toMatchObject({ model: "claude-haiku-5", effort: "max" });
  // A job that reported neither (the default everywhere): nothing is shown.
  const plain = pullState("octo/repo", listed, [
    job(1, "done", { reviewKey: "k2", headSha: HEAD }),
  ]);
  expect(plain.review?.model).toBeUndefined();
  expect(plain.review?.effort).toBeUndefined();
});
