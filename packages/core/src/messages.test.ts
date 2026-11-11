import { expect, test } from "bun:test";
import {
  answeredFindings,
  approvalMessage,
  commentToMarkdown,
  describeLines,
  joinMessages,
  requestChangesMessage,
  resolutionNotesMessage,
} from "./messages.ts";
import type { FindingAnswer, ResolvedFinding, ReviewComment } from "./types.ts";

test("resolutionNotesMessage: empty list → undefined", () => {
  expect(resolutionNotesMessage([])).toBeUndefined();
});

test("resolutionNotesMessage: a few warnings → header + one bullet each + closing line", () => {
  const msg = resolutionNotesMessage([
    'Chapter 1: file "nope.ts" not found in the diff — skipped.',
    '1 file(s) had changes not grouped into any chapter — bucketed into "Unsorted changes".',
  ]);
  expect(msg).toBeDefined();
  const lines = msg!.split("\n");
  expect(lines[0]).toContain("2 resolution notes");
  expect(lines[0]).toContain("could not map this review onto the real diff");
  expect(lines[1]).toBe('- Chapter 1: file "nope.ts" not found in the diff — skipped.');
  expect(lines[2]).toBe(
    '- 1 file(s) had changes not grouped into any chapter — bucketed into "Unsorted changes".',
  );
  expect(lines[3]).toContain("old_start");
  expect(lines[3]).toContain("new_start");
  expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(2);
  expect(lines.some((l) => l.includes("more omitted"))).toBe(false);
});

test("resolutionNotesMessage: more than 10 → exactly 10 bullets plus an N-more line", () => {
  const warnings = Array.from({ length: 13 }, (_, i) => `warning ${i + 1}`);
  const msg = resolutionNotesMessage(warnings);
  expect(msg).toBeDefined();
  const lines = msg!.split("\n");
  expect(lines[0]).toContain("13 resolution notes");
  const bullets = lines.filter((l) => l.startsWith("- "));
  expect(bullets).toHaveLength(10);
  expect(bullets[0]).toBe("- warning 1");
  expect(bullets[9]).toBe("- warning 10");
  expect(lines.some((l) => l.includes("3 more omitted"))).toBe(true);
  expect(lines.at(-1)).toContain("old_start");
});

const comment = (over: Partial<ReviewComment> = {}): ReviewComment => ({
  chapterIndex: 1,
  path: "src/a.ts",
  side: "new",
  line: 12,
  body: "Why is this needed?",
  ...over,
});

test("describeLines: one line, a range on one side, a range across sides", () => {
  expect(describeLines({ side: "new", line: 12 })).toBe("line 12 (new)");
  expect(describeLines({ side: "new", line: 14, startLine: 10 })).toBe("lines 10-14 (new)");
  expect(describeLines({ side: "new", line: 9, startSide: "old", startLine: 7 })).toBe(
    "lines 7 (old) to 9 (new)",
  );
});

test("commentToMarkdown: a body of several lines stays inside the list item", () => {
  expect(commentToMarkdown(comment({ body: "  First.\nSecond.\n" }))).toBe(
    "- `src/a.ts` line 12 (new): First.\n  Second.",
  );
});

test("requestChangesMessage: the note alone keeps its wording", () => {
  expect(requestChangesMessage("  tighten the null check \n")).toBe(
    "Reviewer requested changes:\n\ntighten the null check",
  );
});

test("requestChangesMessage: no note and no comments → the generic message", () => {
  expect(requestChangesMessage(undefined)).toContain("no details provided");
  expect(requestChangesMessage("   ", [])).toContain("no details provided");
});

test("requestChangesMessage: the note, then the comments by file and line", () => {
  const msg = requestChangesMessage("Fix the checks.", [
    comment({ path: "src/b.ts", line: 3, body: "Off by one." }),
    comment({ line: 40, startLine: 38, body: "Rename this." }),
    comment({ side: "old", line: 7, body: "Why was this removed?" }),
  ]);
  expect(msg).toBe(
    [
      "Reviewer requested changes:",
      "",
      "Fix the checks.",
      "",
      '3 line comments ("new" is a line of the changed version, "old" a line of the base version):',
      "- `src/a.ts` line 7 (old): Why was this removed?",
      "- `src/a.ts` lines 38-40 (new): Rename this.",
      "- `src/b.ts` line 3 (new): Off by one.",
    ].join("\n"),
  );
});

test("requestChangesMessage: comments without a note", () => {
  const msg = requestChangesMessage("", [comment()]);
  expect(msg.split("\n").slice(0, 3)).toEqual([
    "Reviewer requested changes.",
    "",
    '1 line comment ("new" is a line of the changed version, "old" a line of the base version):',
  ]);
});

test("requestChangesMessage: long feedback is cut and the rest counted", () => {
  const note = "n".repeat(5000);
  const comments = Array.from({ length: 40 }, (_, i) =>
    comment({ line: i + 1, body: `${i}: ${"b".repeat(3000)}` }),
  );
  const msg = requestChangesMessage(note, comments);
  expect(msg.length).toBeLessThanOrEqual(6000);
  // The note and each body are cut, not dropped.
  expect(msg).toContain(`${"n".repeat(2000)} … (cut)`);
  expect(msg).toContain(`- \`src/a.ts\` line 1 (new): 0: ${"b".repeat(997)} … (cut)`);
  const shown = msg.split("\n").filter((l) => l.startsWith("- ")).length;
  expect(shown).toBeGreaterThan(0);
  expect(msg).toContain(`…and ${40 - shown} more not shown`);
});

test("approvalMessage: nothing to say → undefined", () => {
  expect(approvalMessage(undefined)).toBeUndefined();
  expect(approvalMessage(" ", [])).toBeUndefined();
});

test("approvalMessage: the comments, with or without a note", () => {
  expect(approvalMessage(undefined, [comment()])).toBe(
    [
      "Reviewer approved, with comments.",
      "",
      '1 line comment ("new" is a line of the changed version, "old" a line of the base version):',
      "- `src/a.ts` line 12 (new): Why is this needed?",
    ].join("\n"),
  );
  expect(approvalMessage("Nice work.")).toBe("Reviewer approved, with a note:\n\nNice work.");
});

test("joinMessages: skips missing parts", () => {
  expect(joinMessages(undefined, "a", undefined, "b")).toBe("a\n\nb");
  expect(joinMessages(undefined, "")).toBeUndefined();
});

const resolved = (over: Partial<ResolvedFinding> = {}): ResolvedFinding => ({
  id: "f1",
  path: "src/cache.ts",
  line: 42,
  side: "new",
  severity: "important",
  title: "Cache key ignores the tenant id",
  body: "Two tenants with the same user id share an entry.",
  ...over,
});

test("answeredFindings: joins by id, drops unknown ids, keeps the tool's own text", () => {
  const findings = [resolved(), resolved({ id: "f2", path: "src/a.ts", line: 7, severity: "nit" })];
  const answers: FindingAnswer[] = [
    { id: "f2", decision: "dismiss", reason: "  intentional  " },
    { id: "gone", decision: "fix" },
    { id: "f1", decision: "fix" },
  ];
  expect(answeredFindings(findings, answers)).toEqual([
    // Most severe first, whatever order the answers arrived in.
    {
      path: "src/cache.ts",
      line: 42,
      start_line: undefined,
      side: "new",
      severity: "important",
      title: "Cache key ignores the tenant id",
      decision: "fix",
    },
    {
      path: "src/a.ts",
      line: 7,
      start_line: undefined,
      side: "new",
      severity: "nit",
      title: "Cache key ignores the tenant id",
      decision: "dismiss",
      reason: "intentional",
    },
  ]);
  // The finding's body never travels: the agent wrote it.
  expect(JSON.stringify(answeredFindings(findings, answers))).not.toContain("Two tenants");
});

test("answeredFindings: nothing to join → empty", () => {
  expect(answeredFindings(undefined, [{ id: "f1", decision: "fix" }])).toEqual([]);
  expect(answeredFindings([resolved()], undefined)).toEqual([]);
  expect(
    answeredFindings(
      [resolved()],
      [
        { id: "f1", decision: "fix" },
        { id: "f1", decision: "dismiss" },
      ],
    ),
  ).toHaveLength(
    1, // one answer per finding, the first one
  );
});

test("requestChangesMessage: the findings to fix, then the dismissed ones with their reason", () => {
  const msg = requestChangesMessage(
    "",
    [],
    answeredFindings(
      [
        resolved(),
        resolved({ id: "f2", path: "src/a.ts", line: 7, severity: "nit", title: "Unused import" }),
        resolved({
          id: "f3",
          path: "src/b.ts",
          line: 9,
          start_line: 8,
          severity: "important",
          title: "Null deref",
        }),
      ],
      [
        { id: "f1", decision: "fix" },
        { id: "f2", decision: "dismiss", reason: "intentional, used by the codegen" },
        { id: "f3", decision: "fix" },
      ],
    ),
  );
  expect(msg).toBe(
    [
      "Reviewer requested changes.",
      "",
      "Findings to fix:",
      "- `src/b.ts` lines 8-9 (new): Null deref",
      "- `src/cache.ts` line 42 (new): Cache key ignores the tenant id",
      "Dismissed by the reviewer (do not raise these again):",
      '- `src/a.ts` line 7 (new): Unused import — "intentional, used by the codegen"',
    ].join("\n"),
  );
});

test("approvalMessage: answered findings alone are worth a message", () => {
  const msg = approvalMessage(
    undefined,
    [],
    answeredFindings([resolved()], [{ id: "f1", decision: "fix" }]),
  );
  expect(msg).toBe(
    [
      "Reviewer approved, and answered the findings.",
      "",
      "Findings to fix:",
      "- `src/cache.ts` line 42 (new): Cache key ignores the tenant id",
    ].join("\n"),
  );
});

test("requestChangesMessage: comments come first, and the findings share the cap", () => {
  const comments = Array.from({ length: 40 }, (_, i) =>
    comment({ line: i + 1, body: `${i}: ${"b".repeat(3000)}` }),
  );
  const findings = Array.from({ length: 50 }, (_, i) =>
    resolved({ id: `f${i}`, line: i + 1, title: `Finding ${i} ${"t".repeat(150)}` }),
  );
  const answers: FindingAnswer[] = findings.map((f) => ({ id: f.id, decision: "fix" }));
  const msg = requestChangesMessage("Fix it.", comments, answeredFindings(findings, answers));
  expect(msg.length).toBeLessThanOrEqual(6000);
  expect(msg).toContain('40 line comments ("new"');
  // Many long comments must not swallow the answers: both blocks are there,
  // and neither drops anything silently — what did not fit is counted.
  expect(msg).toContain("Findings to fix:");
  expect(msg).toMatch(/…and \d+ more not shown/);
  expect(msg).toMatch(/…and \d+ more answered, not shown/);
});

test("findings block: a long dismissal reason is cut, not dropped", () => {
  const msg = approvalMessage(
    undefined,
    [],
    answeredFindings([resolved()], [{ id: "f1", decision: "dismiss", reason: "r".repeat(500) }]),
  );
  expect(msg).toContain(`"${"r".repeat(300)} … (cut)"`);
});
