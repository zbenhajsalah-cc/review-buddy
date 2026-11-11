import { expect, test } from "bun:test";
import {
  checksFromRest,
  checksFromRollup,
  ciCheckStatus,
  ciMetadata,
  ciSummary,
} from "./checks.ts";

test("maps GitHub's words to a status, in any case", () => {
  expect(ciCheckStatus("COMPLETED", "SUCCESS")).toBe("passed");
  expect(ciCheckStatus("completed", "failure")).toBe("failed");
  expect(ciCheckStatus("completed", "timed_out")).toBe("failed");
  expect(ciCheckStatus("completed", "cancelled")).toBe("failed");
  expect(ciCheckStatus("completed", "skipped")).toBe("skipped");
  expect(ciCheckStatus("completed", "neutral")).toBe("skipped");
  expect(ciCheckStatus("IN_PROGRESS", "")).toBe("pending");
  expect(ciCheckStatus("queued", null)).toBe("pending");
  // Commit statuses: only a state.
  expect(ciCheckStatus("", "ERROR")).toBe("failed");
  expect(ciCheckStatus("", "PENDING")).toBe("pending");
  expect(ciCheckStatus("", "EXPECTED")).toBe("pending");
});

test("reads gh's statusCheckRollup: check runs and statuses, failed first", () => {
  const checks = checksFromRollup([
    {
      __typename: "CheckRun",
      name: "test (ubuntu)",
      workflowName: "CI",
      status: "COMPLETED",
      conclusion: "SUCCESS",
      detailsUrl: "https://github.com/o/r/actions/runs/1/job/2",
    },
    {
      __typename: "CheckRun",
      name: "test (windows)",
      workflowName: "CI",
      status: "COMPLETED",
      conclusion: "FAILURE",
      detailsUrl: "https://github.com/o/r/actions/runs/1/job/3",
    },
    {
      __typename: "StatusContext",
      context: "ci/circleci",
      state: "PENDING",
      targetUrl: "javascript:alert(1)",
    },
    { __typename: "CheckRun", name: "", status: "COMPLETED", conclusion: "SUCCESS" },
    null,
  ]);
  expect(checks).toEqual([
    {
      name: "CI / test (windows)",
      status: "failed",
      url: "https://github.com/o/r/actions/runs/1/job/3",
    },
    { name: "ci/circleci", status: "pending" },
    {
      name: "CI / test (ubuntu)",
      status: "passed",
      url: "https://github.com/o/r/actions/runs/1/job/2",
    },
  ]);
});

test("no rollup, or an empty one, gives undefined", () => {
  expect(checksFromRollup(undefined)).toBeUndefined();
  expect(checksFromRollup([])).toBeUndefined();
  expect(checksFromRollup("nope")).toBeUndefined();
});

test("reads the REST check runs and commit statuses", () => {
  const checks = checksFromRest(
    {
      check_runs: [
        {
          name: "lint",
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/o/r/runs/9",
        },
        { name: "build", status: "in_progress", conclusion: null },
      ],
    },
    { statuses: [{ context: "deploy", state: "failure", target_url: "http://x.test" }] },
  );
  expect(checks).toEqual([
    { name: "deploy", status: "failed" },
    { name: "build", status: "pending" },
    { name: "lint", status: "passed", url: "https://github.com/o/r/runs/9" },
  ]);
  expect(checksFromRest(null, undefined)).toBeUndefined();
  expect(checksFromRest({ check_runs: [] }, { statuses: [] })).toBeUndefined();
});

test("summarizes only the counts that are not zero", () => {
  expect(
    ciSummary([
      { name: "a", status: "passed" },
      { name: "b", status: "passed" },
      { name: "c", status: "failed" },
    ]),
  ).toBe("1 failed, 2 passed");
  expect(ciSummary([])).toBe("");
});

test("keeps every check (no cap), so a failure after 100 passes is kept and counted", () => {
  const runs = Array.from({ length: 150 }, (_, i) => ({
    name: `run ${i}`,
    status: "completed",
    conclusion: i === 149 ? "failure" : "success",
  }));
  const checks = checksFromRest({ check_runs: runs }, undefined);
  expect(checks).toHaveLength(150);
  expect(checks?.[0]).toEqual({ name: "run 149", status: "failed" });
  expect(ciSummary(checks ?? [])).toBe("1 failed, 149 passed");
});

test("ciMetadata: summary, the incomplete flag, and nothing without checks", () => {
  const checks = [{ name: "a", status: "passed" as const }];
  expect(ciMetadata(checks)).toEqual({ checks, ciStatus: "1 passed" });
  expect(ciMetadata(checks, true)).toEqual({
    checks,
    ciStatus: "1 passed (incomplete)",
    checksIncomplete: true,
  });
  expect(ciMetadata(undefined, true)).toEqual({});
  expect(ciMetadata([])).toEqual({});
});
