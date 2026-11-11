import { expect, test } from "bun:test";
import { parseDoneResult, validateAgentReview } from "./validate.ts";

const good = {
  prologue: {
    why: "w",
    what: "x",
    key_changes: [{ headline: "h", detail: "d" }],
    review_focus: { summary: "s", file: "app.ts" },
  },
  chapters: [
    {
      index: 1,
      title: "t",
      risk: "Low",
      risk_reason: "r",
      description: "d",
      files: [{ path: "app.ts", change_type: "modified" }],
    },
  ],
};

test("accepts a well-formed agent review", () => {
  expect(validateAgentReview(good)).toBeNull();
});

test("accepts extra keys (source/stats) without stripping-driven failure", () => {
  expect(validateAgentReview({ ...good, source: { type: "pr", ref: "42" }, stats: {} })).toBeNull();
});

test("rejects chapter index < 1 (kills the -1 sentinel)", () => {
  const bad = { ...good, chapters: [{ ...good.chapters[0], index: -1 }] };
  expect(validateAgentReview(bad)).toContain("index");
});

test("rejects a risk value outside the enum", () => {
  const bad = { ...good, chapters: [{ ...good.chapters[0], risk: "Critical" }] };
  expect(validateAgentReview(bad)).not.toBeNull();
});

test("rejects a missing prologue field", () => {
  const { why, ...restProl } = good.prologue;
  expect(validateAgentReview({ ...good, prologue: restProl })).not.toBeNull();
});

const withQuestions = (open_questions: unknown) => ({
  ...good,
  prologue: { ...good.prologue, open_questions },
});
const question = (n: number) => ({ question: `Should we do ${n}?`, context: "docs/x.md" });

test("accepts 0 to 3 open questions, and none at all", () => {
  for (const n of [0, 1, 2, 3]) {
    const qs = Array.from({ length: n }, (_, i) => question(i));
    expect(validateAgentReview(withQuestions(qs))).toBeNull();
  }
  expect(validateAgentReview(withQuestions([{ question: "No context?" }]))).toBeNull();
});

test("rejects more than 3 open questions", () => {
  const qs = [1, 2, 3, 4].map(question);
  expect(validateAgentReview(withQuestions(qs))).toContain("open_questions");
});

test("rejects an empty open question", () => {
  expect(validateAgentReview(withQuestions([{ question: "" }]))).toContain("question");
  expect(validateAgentReview(withQuestions([{ question: "  " }]))).toContain("question");
});

const withChecks = (verification: unknown) => ({ ...good, verification });
const check = (n: number, status = "passed") => ({ command: `pnpm test:${n}`, status });

test("accepts verification with each status, and none at all", () => {
  for (const status of ["passed", "failed", "not_run"]) {
    expect(validateAgentReview(withChecks({ checks: [check(1, status)] }))).toBeNull();
  }
  expect(validateAgentReview(withChecks({ not_covered: "Ran nothing." }))).toBeNull();
  expect(validateAgentReview(withChecks({}))).toBeNull();
  expect(validateAgentReview(good)).toBeNull();
});

test("rejects an unknown check status", () => {
  const msg = validateAgentReview(withChecks({ checks: [check(1, "skipped")] }));
  expect(msg).toContain("verification.checks.0.status");
});

test("rejects more than 20 checks", () => {
  const checks = Array.from({ length: 21 }, (_, i) => check(i));
  expect(validateAgentReview(withChecks({ checks }))).toContain("verification.checks");
  expect(validateAgentReview(withChecks({ checks: checks.slice(0, 20) }))).toBeNull();
});

test("rejects a long summary (pasted output) and an empty command", () => {
  const long = { ...check(1), summary: "x".repeat(201) };
  expect(validateAgentReview(withChecks({ checks: [long] }))).toContain("summary");
  const short = { ...check(1), summary: "x".repeat(200) };
  expect(validateAgentReview(withChecks({ checks: [short] }))).toBeNull();
  const empty = { command: " ", status: "passed" };
  expect(validateAgentReview(withChecks({ checks: [empty] }))).toContain("command");
});

const withFindings = (findings: unknown) => ({ ...good, findings });
const aFinding = (over: Record<string, unknown> = {}) => ({
  path: "src/a.ts",
  line: 4,
  severity: "important",
  title: "Off by one",
  ...over,
});

test("accepts findings of each severity and side, and none at all", () => {
  for (const severity of ["important", "nit", "pre_existing"]) {
    expect(validateAgentReview(withFindings([aFinding({ severity })]))).toBeNull();
  }
  expect(validateAgentReview(withFindings([aFinding({ side: "old", start_line: 2 })]))).toBeNull();
  expect(validateAgentReview(withFindings([]))).toBeNull();
});

test("rejects a bad finding: severity, line, empty title, long title or body", () => {
  expect(validateAgentReview(withFindings([aFinding({ severity: "blocker" })]))).toContain(
    "findings.0.severity",
  );
  expect(validateAgentReview(withFindings([aFinding({ line: 0 })]))).toContain("line");
  expect(validateAgentReview(withFindings([aFinding({ title: " " })]))).toContain("title");
  expect(validateAgentReview(withFindings([aFinding({ title: "x".repeat(201) })]))).toContain(
    "title",
  );
  expect(validateAgentReview(withFindings([aFinding({ body: "x".repeat(1001) })]))).toContain(
    "body",
  );
  expect(validateAgentReview(withFindings([aFinding({ start_line: 9 })]))).toContain("start_line");
});

test("rejects more than 50 findings", () => {
  const many = Array.from({ length: 51 }, (_, i) => aFinding({ title: `t${i}` }));
  expect(validateAgentReview(withFindings(many))).toContain("findings");
  expect(validateAgentReview(withFindings(many.slice(0, 50)))).toBeNull();
});

test("rejects source.type pr without a ref (silent-worktree bug)", () => {
  const bad = { ...good, source: { type: "pr" } };
  const msg = validateAgentReview(bad);
  expect(msg).not.toBeNull();
  expect(msg).toContain("ref");
});

test("rejects source.type branch without a ref", () => {
  const bad = { ...good, source: { type: "branch" } };
  expect(validateAgentReview(bad)).not.toBeNull();
});

test("rejects an unknown source.type", () => {
  const bad = { ...good, source: { type: "prr", ref: "42" } };
  expect(validateAgentReview(bad)).not.toBeNull();
});

test("still accepts a valid pr source and absent source", () => {
  expect(validateAgentReview({ ...good, source: { type: "pr", ref: "42" } })).toBeNull();
  expect(validateAgentReview(good)).toBeNull();
});

test("rejects an absurd chapter count (size cap)", () => {
  const many = Array.from({ length: 501 }, (_, i) => ({ ...good.chapters[0], index: i + 1 }));
  expect(validateAgentReview({ ...good, chapters: many })).not.toBeNull();
});

test("parseDoneResult: an empty body is a plain Done", () => {
  expect(parseDoneResult({})).toEqual({ ok: true, value: {} });
});

test("parseDoneResult: a verdict with a note and comments; unknown keys are dropped", () => {
  const comment = { chapterIndex: 2, path: "a.ts", side: "new" as const, line: 9, body: "Why?" };
  const range = {
    ...comment,
    side: "old" as const,
    line: 4,
    startSide: "old" as const,
    startLine: 2,
  };
  const parsed = parseDoneResult({
    verdict: "request_changes",
    summary: "Fix it.",
    comments: [
      { ...comment, id: "x1" },
      { ...range, id: "x2" },
    ],
    superseded: true,
  });
  expect(parsed).toEqual({
    ok: true,
    value: { verdict: "request_changes", summary: "Fix it.", comments: [comment, range] },
  });
});

test("parseDoneResult: finding answers, with the reason trimmed of nothing it does not have", () => {
  const parsed = parseDoneResult({
    verdict: "approve",
    findings: [
      { id: "ab12cd34", decision: "fix" },
      { id: "ef56", decision: "dismiss", reason: "intentional, used by the codegen" },
    ],
  });
  expect(parsed).toEqual({
    ok: true,
    value: {
      verdict: "approve",
      findings: [
        { id: "ab12cd34", decision: "fix" },
        { id: "ef56", decision: "dismiss", reason: "intentional, used by the codegen" },
      ],
    },
  });
});

test("parseDoneResult: at most one answer per finding of the cap (50)", () => {
  const answer = (i: number) => ({ id: `f${i}`, decision: "fix" as const });
  const fifty = Array.from({ length: 50 }, (_, i) => answer(i));
  expect(parseDoneResult({ findings: fifty }).ok).toBe(true);
  expect(parseDoneResult({ findings: [...fifty, answer(50)] }).ok).toBe(false);
});

test("parseDoneResult: names what is malformed", () => {
  const bad = (body: unknown) => {
    const parsed = parseDoneResult(body);
    if (parsed.ok) throw new Error("expected a failure");
    return parsed.error;
  };
  expect(bad({ verdict: "maybe" })).toContain("verdict");
  expect(bad({ summary: 123 })).toContain("summary");
  expect(
    bad({ comments: [{ chapterIndex: 1, path: "a.ts", side: "up", line: 1, body: "" }] }),
  ).toContain("comments.0.side");
  expect(
    bad({ comments: [{ chapterIndex: 1, path: "a.ts", side: "new", line: 0, body: "" }] }),
  ).toContain("comments.0.line");
  expect(bad({ findings: [{ id: "f1", decision: "maybe" }] })).toContain("findings.0.decision");
  expect(bad({ findings: [{ decision: "fix" }] })).toContain("findings.0.id");
  expect(bad(null)).toContain("(root)");
});
