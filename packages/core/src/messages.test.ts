import { expect, test } from "bun:test";
import {
  approvalMessage,
  commentToMarkdown,
  describeLines,
  joinMessages,
  requestChangesMessage,
  resolutionNotesMessage,
} from "./messages.ts";
import type { ReviewComment } from "./types.ts";

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
