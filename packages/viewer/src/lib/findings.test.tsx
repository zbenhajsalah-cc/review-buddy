/// <reference types="bun-types" />
import { afterEach, expect, test } from "bun:test";
import type { FindingAnswer, ResolvedFinding } from "@review-buddy/core/types";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReviewApiProvider } from "../review-api.tsx";
import { fakeReviewApi } from "../stories/fixtures.ts";
import { clearReviewFileState } from "./chapterFileSet.ts";
import {
  answersById,
  answersToSend,
  chapterFindings,
  findingCounts,
  findingLines,
  findingToMarkdown,
  MAX_FINDING_REASON,
  openFindings,
  otherFindings,
  readFindingAnswers,
  sortFindings,
  useFindingAnswers,
} from "./findings.ts";

// fakeReviewApi()'s reviewKey is "fake-review".
const KEY = "rb.findings.fake-review";

afterEach(() => {
  cleanup();
  localStorage.removeItem(KEY);
});

const f = (over: Partial<ResolvedFinding>): ResolvedFinding => ({
  id: over.title ?? "x",
  path: "a.ts",
  line: 1,
  side: "new",
  severity: "nit",
  title: "t",
  ...over,
});

test("counts: only the severities present, with plurals", () => {
  expect(
    findingCounts([
      f({ severity: "important" }),
      f({ severity: "important" }),
      f({ severity: "important" }),
      f({ severity: "nit" }),
      f({ severity: "nit" }),
      f({ severity: "pre_existing" }),
    ]),
  ).toBe("3 important · 2 nits · 1 pre-existing");
  expect(findingCounts([f({ severity: "nit" })])).toBe("1 nit");
  expect(findingCounts([])).toBe("");
});

test("sorted by severity, then path and line", () => {
  const sorted = sortFindings([
    f({ title: "nit b", path: "b.ts" }),
    f({ title: "pre", severity: "pre_existing" }),
    f({ title: "imp 9", severity: "important", line: 9 }),
    f({ title: "imp 2", severity: "important", line: 2 }),
    f({ title: "nit a", path: "a.ts" }),
  ]);
  expect(sorted.map((x) => x.title)).toEqual(["imp 2", "imp 9", "nit a", "nit b", "pre"]);
});

test("lines: one line or a range, with the side", () => {
  expect(findingLines(f({ line: 42 }))).toBe("line 42 (new)");
  expect(findingLines(f({ line: 42, start_line: 40, side: "old" }))).toBe("lines 40-42 (old)");
});

test("chapter and other findings split by chapterIndex", () => {
  const all = [f({ title: "in 1", chapterIndex: 1 }), f({ title: "none" })];
  expect(chapterFindings(all, 1).map((x) => x.title)).toEqual(["in 1"]);
  expect(chapterFindings(undefined, 1)).toEqual([]);
  expect(otherFindings(all).map((x) => x.title)).toEqual(["none"]);
});

test("Markdown: location, severity, title, notes, and an indented body", () => {
  expect(
    findingToMarkdown(
      f({
        severity: "important",
        path: "src/a.ts",
        line: 7,
        title: "Off by one",
        source: "/code-review",
        outsideDiff: true,
        body: "First.\nSecond.",
      }),
    ),
  ).toBe(
    "- **Important** `src/a.ts` line 7 (new): Off by one (outside the diff, from /code-review)\n  First.\n  Second.",
  );
  expect(findingToMarkdown(f({ title: "Plain" }))).toBe("- **Nit** `a.ts` line 1 (new): Plain");
});

/* ---------------- the reviewer's answers ---------------- */

const wrapper = ({ children }: { children: ReactNode }) => (
  <ReviewApiProvider api={fakeReviewApi()}>{children}</ReviewApiProvider>
);

const renderAnswers = () => renderHook(() => useFindingAnswers(), { wrapper });

test("answers: fix, dismiss with a reason, replace, undo — persisted per review", () => {
  const { result } = renderAnswers();
  act(() => result.current.answer("f1", "fix"));
  act(() => result.current.answer("f2", "dismiss", "  intentional  "));
  expect(result.current.answers).toEqual([
    { id: "f1", decision: "fix" },
    { id: "f2", decision: "dismiss", reason: "intentional" },
  ]);
  expect(readFindingAnswers("fake-review")).toEqual([...result.current.answers]);

  // Answering again replaces, it does not pile up.
  act(() => result.current.answer("f1", "dismiss", "not worth it"));
  expect(result.current.answers).toEqual([
    { id: "f2", decision: "dismiss", reason: "intentional" },
    { id: "f1", decision: "dismiss", reason: "not worth it" },
  ]);

  act(() => result.current.clearAnswer("f2"));
  expect(result.current.answers).toEqual([
    { id: "f1", decision: "dismiss", reason: "not worth it" },
  ]);
});

test("answers: a blank reason is no reason, and junk in storage is dropped", () => {
  localStorage.setItem(
    KEY,
    JSON.stringify([
      { id: "ok", decision: "fix" },
      { id: "bad", decision: "maybe" },
      { decision: "fix" },
      "nope",
    ]),
  );
  const { result } = renderAnswers();
  expect(result.current.answers).toEqual([{ id: "ok", decision: "fix" }]);
  act(() => result.current.answer("blank", "dismiss", "   "));
  expect(result.current.answers.at(-1)).toEqual({ id: "blank", decision: "dismiss" });
});

test("answers: Done clears them with the rest of the review's state", () => {
  const { result } = renderAnswers();
  act(() => result.current.answer("f1", "fix"));
  expect(localStorage.getItem(KEY)).not.toBeNull();
  clearReviewFileState("fake-review");
  expect(localStorage.getItem(KEY)).toBeNull();
});

test("openFindings: the ones with no answer, most severe first", () => {
  const findings = [
    f({ id: "n", severity: "nit" }),
    f({ id: "i", severity: "important" }),
    f({ id: "p", severity: "pre_existing" }),
  ];
  const answers: FindingAnswer[] = [{ id: "i", decision: "fix" }];
  expect(openFindings(findings, answers).map((x) => x.id)).toEqual(["n", "p"]);
  expect(openFindings(findings, []).map((x) => x.id)).toEqual(["i", "n", "p"]);
  expect(openFindings(undefined, answers)).toEqual([]);
});

test("answersToSend: a stale answer, whose finding is gone, stays behind", () => {
  const answers: FindingAnswer[] = [
    { id: "here", decision: "fix" },
    { id: "gone", decision: "dismiss", reason: "old round" },
  ];
  expect(answersToSend([f({ id: "here" })], answers)).toEqual([{ id: "here", decision: "fix" }]);
  expect(answersToSend(undefined, answers)).toEqual([]);
});

test("answersById: by finding id", () => {
  const map = answersById([{ id: "f1", decision: "fix" }]);
  expect(map.get("f1")).toEqual({ id: "f1", decision: "fix" });
  expect(map.get("f2")).toBeUndefined();
});

test("findingToMarkdown: the answer, with its reason, under the finding", () => {
  const finding = f({ title: "Cache key ignores the tenant id", path: "src/cache.ts", line: 42 });
  expect(findingToMarkdown(finding, { id: finding.id, decision: "fix" })).toBe(
    "- **Nit** `src/cache.ts` line 42 (new): Cache key ignores the tenant id\n  → To fix",
  );
  expect(
    findingToMarkdown(finding, {
      id: finding.id,
      decision: "dismiss",
      reason: "by design\nreally",
    }),
  ).toContain("→ Dismissed: by design really");
  expect(findingToMarkdown(finding)).not.toContain("→");
});

test("answers: a reason longer than the server accepts is cut, not sent whole", () => {
  const { result } = renderAnswers();
  act(() => result.current.answer("f1", "dismiss", "r".repeat(MAX_FINDING_REASON + 500)));
  expect(result.current.answers[0]?.reason).toHaveLength(MAX_FINDING_REASON);

  // And one that got into storage some other way is cut before it is sent.
  localStorage.setItem(
    KEY,
    JSON.stringify([{ id: "f1", decision: "dismiss", reason: "r".repeat(9000) }]),
  );
  const { result: reread } = renderAnswers();
  const sent = answersToSend([f({ id: "f1" })], reread.current.answers);
  expect(sent[0]?.reason).toHaveLength(MAX_FINDING_REASON);
});
