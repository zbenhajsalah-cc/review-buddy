/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import type { ResolvedFile } from "@review-buddy/core/types";
import { fileToPatch } from "./patch.ts";

const baseHunk = {
  old_start: 1,
  old_lines: 1,
  new_start: 1,
  new_lines: 1,
  header: "@@ -1 +1 @@",
  lines: ["-a", "+b"],
};

const fileDefaults = {
  additions: 0,
  deletions: 0,
  language: "typescript",
};

test("modified file produces unified diff with a/ and b/ headers", () => {
  const f: ResolvedFile = {
    path: "x.ts",
    change_type: "modified",
    hunks: [baseHunk],
    ...fileDefaults,
  };
  expect(fileToPatch(f)).toBe(
    "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n",
  );
});

test("added file uses /dev/null on the old side", () => {
  const f: ResolvedFile = {
    path: "new.ts",
    change_type: "added",
    hunks: [
      {
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: 1,
        header: "@@ -0,0 +1 @@",
        lines: ["+hi"],
      },
    ],
    ...fileDefaults,
  };
  expect(fileToPatch(f)).toBe(
    "diff --git a/new.ts b/new.ts\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+hi\n",
  );
});

test("deleted file uses /dev/null on the new side", () => {
  const f: ResolvedFile = {
    path: "gone.ts",
    change_type: "deleted",
    hunks: [
      {
        old_start: 1,
        old_lines: 1,
        new_start: 0,
        new_lines: 0,
        header: "@@ -1 +0,0 @@",
        lines: ["-bye"],
      },
    ],
    ...fileDefaults,
  };
  expect(fileToPatch(f)).toBe(
    "diff --git a/gone.ts b/gone.ts\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n",
  );
});

test("renamed file uses old_path in header sides", () => {
  const f: ResolvedFile = {
    path: "new.ts",
    old_path: "old.ts",
    change_type: "renamed",
    hunks: [baseHunk],
    ...fileDefaults,
  };
  expect(fileToPatch(f)).toBe(
    "diff --git a/old.ts b/new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-a\n+b\n",
  );
});

test("empty hunks produces header only with no trailing hunk newline", () => {
  const f: ResolvedFile = {
    path: "logo.png",
    change_type: "modified",
    binary: true,
    hunks: [],
    ...fileDefaults,
  };
  const result = fileToPatch(f);
  expect(result).toBe("diff --git a/logo.png b/logo.png\n--- a/logo.png\n+++ b/logo.png\n");
  expect(result.endsWith("+++ b/logo.png\n")).toBe(true);
  expect(result).not.toBe(`${result}\n`);
});

test("\\ No newline at end of file marker passes through verbatim", () => {
  const f: ResolvedFile = {
    path: "x.ts",
    change_type: "modified",
    hunks: [
      {
        ...baseHunk,
        lines: ["-a", "+b", "\\ No newline at end of file"],
      },
    ],
    ...fileDefaults,
  };
  const result = fileToPatch(f);
  expect(result.includes("\\ No newline at end of file")).toBe(true);
  expect(result.endsWith("\\ No newline at end of file\n")).toBe(true);
});
