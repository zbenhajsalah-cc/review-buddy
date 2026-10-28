import { expect, test } from "bun:test";
import type { ReviewJobStatus } from "../shared/ipc.ts";
import { jobNotice, pageUrlForJob } from "./job-notice.ts";

const job = (more: Partial<ReviewJobStatus>): ReviewJobStatus => ({
  id: 1,
  pr: "octo/repo#7",
  state: "done",
  steps: [],
  ...more,
});

test("a review that is done is ready to read", () => {
  expect(jobNotice(job({ reviewKey: "octo/repo#7@abc" }))).toEqual({
    title: "Review ready",
    body: "octo/repo#7 is ready to read.",
  });
});

test("a failed review says why, in one short line", () => {
  expect(
    jobNotice(
      job({
        state: "failed",
        errorKind: "claude",
        error: "Claude Code is not logged in.\n(Claude Code 2.1.0, /usr/bin/claude)",
      }),
    ),
  ).toEqual({ title: "Review failed", body: "octo/repo#7: Claude Code is not logged in." });

  const long = jobNotice(job({ state: "failed", errorKind: "agent", error: "x".repeat(500) }));
  expect(long?.body.length).toBe(140);
  expect(long?.body.endsWith("…")).toBe(true);
});

test("nothing for a review the user stopped, or one still going", () => {
  expect(jobNotice(job({ state: "failed", errorKind: "stopped", error: "Stopped." }))).toBeNull();
  expect(jobNotice(job({ state: "running" }))).toBeNull();
  expect(jobNotice(job({ state: "queued" }))).toBeNull();
});

test("a new window for a notification click is told the job", () => {
  expect(pageUrlForJob("app://renderer/index.html", 3)).toBe("app://renderer/index.html?job=3");
  expect(pageUrlForJob("http://localhost:5173/", 12)).toBe("http://localhost:5173/?job=12");
});
