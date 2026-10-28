import { expect, test } from "bun:test";
import { elapsed, failureHint, failureTitle, ipcErrorMessage, PHASES } from "./ReviewRun.tsx";

test("ipcErrorMessage drops Electron's wrapper", () => {
  expect(
    ipcErrorMessage(
      new Error("Error invoking remote method 'review:start': Error: A review is already running."),
    ),
  ).toBe("A review is already running.");
  expect(ipcErrorMessage(new Error("plain"))).toBe("plain");
  expect(ipcErrorMessage("text")).toBe("text");
});

test("elapsed", () => {
  expect(elapsed(0)).toBe("0:00");
  expect(elapsed(7_400)).toBe("0:07");
  expect(elapsed(765_000)).toBe("12:45");
  expect(elapsed(3_723_000)).toBe("1:02:03");
  expect(elapsed(-5)).toBe("0:00");
});

test("a failure is named by what failed", () => {
  const pr = "octo/repo#7";
  expect(failureTitle("github", pr)).toBe("Could not read octo/repo#7 from GitHub");
  expect(failureTitle("too-large", pr)).toBe(
    "octo/repo#7 is too large for the GitHub API, and the local copy failed",
  );
  expect(failureTitle("claude", pr)).toBe("Claude could not review octo/repo#7");
  expect(failureTitle("stopped", pr)).toBe("The review of octo/repo#7 was stopped");
  expect(failureTitle("agent", pr)).toBe("Claude did not finish the review of octo/repo#7");
  expect(failureTitle(undefined, pr)).toBe(failureTitle("agent", pr));
  expect(failureHint("too-large")).toContain("with git, from a local copy");
  expect(failureHint("claude")).toBeUndefined();
});

test("the phases are in order", () => {
  expect(PHASES.map((p) => p.phase)).toEqual(["github", "reading", "writing", "checking"]);
});
