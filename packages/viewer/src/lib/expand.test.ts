/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import type { ResolvedFile } from "@review-buddy/core/types";
import { buildExpandedDiff, canExpand, requiredSides } from "./expand.ts";

const fileDefaults = {
  additions: 0,
  deletions: 0,
  language: "typescript",
  hunks: [] as ResolvedFile["hunks"],
};

function makeFile(
  overrides: Partial<ResolvedFile> & Pick<ResolvedFile, "path" | "change_type">,
): ResolvedFile {
  return { ...fileDefaults, ...overrides };
}

test("requiredSides: modified → both sides required", () => {
  expect(requiredSides("modified")).toEqual({ base: true, head: true });
});

test("requiredSides: added → head only", () => {
  expect(requiredSides("added")).toEqual({ base: false, head: true });
});

test("requiredSides: deleted → base only", () => {
  expect(requiredSides("deleted")).toEqual({ base: true, head: false });
});

test("canExpand: modified with both sides present → true", () => {
  const file = makeFile({ path: "x.ts", change_type: "modified" });
  expect(canExpand(file, "base\n", "head\n")).toBe(true);
});

test("canExpand: modified with empty head → false", () => {
  const file = makeFile({ path: "x.ts", change_type: "modified" });
  expect(canExpand(file, "base\n", "")).toBe(false);
});

test("canExpand: modified with empty base → false", () => {
  const file = makeFile({ path: "x.ts", change_type: "modified" });
  expect(canExpand(file, "", "head\n")).toBe(false);
});

test("canExpand: added with empty base → true", () => {
  const file = makeFile({ path: "new.ts", change_type: "added" });
  expect(canExpand(file, "", "content\n")).toBe(true);
});

test("canExpand: deleted with empty head → true", () => {
  const file = makeFile({ path: "gone.ts", change_type: "deleted" });
  expect(canExpand(file, "content\n", "")).toBe(true);
});

test('buildExpandedDiff: modified with trailing newline — byte-fidelity via join("")', () => {
  const base = "line one\nline two\n";
  const head = "line one\nline two changed\n";
  const file = makeFile({ path: "x.ts", change_type: "modified" });
  const meta = buildExpandedDiff(file, base, head);
  expect(meta.isPartial).toBe(false);
  expect(meta.additionLines.join("")).toBe(head);
  expect(meta.deletionLines.join("")).toBe(base);
});

test("buildExpandedDiff: modified without trailing newline — no phantom line", () => {
  const base = "line one\nline two";
  const head = "line one\nline two changed";
  const file = makeFile({ path: "x.ts", change_type: "modified" });
  const meta = buildExpandedDiff(file, base, head);
  expect(meta.isPartial).toBe(false);
  expect(meta.additionLines.join("")).toBe(head);
  expect(meta.deletionLines.join("")).toBe(base);
});

test("buildExpandedDiff: added file — additionLines reconstruct head", () => {
  const head = "new content\n";
  const file = makeFile({ path: "new.ts", change_type: "added" });
  const meta = buildExpandedDiff(file, "", head);
  expect(meta.isPartial).toBe(false);
  expect(meta.additionLines.join("")).toBe(head);
});
