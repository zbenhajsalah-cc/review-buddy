import { expect, test } from "bun:test";
import { resolutionNotesMessage } from "./session.ts";

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
