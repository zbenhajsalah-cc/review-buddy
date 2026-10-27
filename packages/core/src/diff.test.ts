import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { languageOf, parseDiff } from "./diff.ts";

const SAMPLE = `diff --git a/src/dashboard/useSport.ts b/src/dashboard/useSport.ts
index 1111111..2222222 100644
--- a/src/dashboard/useSport.ts
+++ b/src/dashboard/useSport.ts
@@ -12,6 +12,9 @@ export function useSport() {
   const user = useUser();
-  return user.sport;
+  return user?.sport ?? sports[0];
+
+  // extra
@@ -40,3 +43,3 @@
   foo
-  bar
+  baz
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-obsolete
diff --git a/old/name.ts b/new/name.ts
similarity index 95%
rename from old/name.ts
rename to new/name.ts
index 5555555..6666666 100644
--- a/old/name.ts
+++ b/new/name.ts
@@ -1,2 +1,2 @@
 keep
-old
+new
diff --git a/logo.png b/logo.png
index 7777777..8888888 100644
Binary files a/logo.png and b/logo.png differ
`;

describe("parseDiff", () => {
  const files = parseDiff(SAMPLE);

  test("parses every file in the diff", () => {
    expect(files.map((f) => f.path)).toEqual([
      "src/dashboard/useSport.ts",
      "new.txt",
      "gone.txt",
      "new/name.ts",
      "logo.png",
    ]);
  });

  test("modified file: hunk anchors, counts, and verbatim lines", () => {
    const f = files[0]!;
    expect(f.changeType).toBe("modified");
    expect(f.hunks).toHaveLength(2);

    const h0 = f.hunks[0]!;
    expect(h0.oldStart).toBe(12);
    expect(h0.oldLines).toBe(6);
    expect(h0.newStart).toBe(12);
    expect(h0.newLines).toBe(9);
    expect(h0.header).toBe("@@ -12,6 +12,9 @@ export function useSport() {");
    expect(h0.additions).toBe(3);
    expect(h0.deletions).toBe(1);
    expect(h0.lines).toEqual([
      "   const user = useUser();",
      "-  return user.sport;",
      "+  return user?.sport ?? sports[0];",
      "+",
      "+  // extra",
    ]);

    expect(f.additions).toBe(4); // 3 + 1 across both hunks
    expect(f.deletions).toBe(2);
  });

  test("added file", () => {
    const f = files[1]!;
    expect(f.changeType).toBe("added");
    expect(f.hunks[0]!.oldStart).toBe(0);
    expect(f.hunks[0]!.newLines).toBe(2);
    expect(f.additions).toBe(2);
    expect(f.deletions).toBe(0);
  });

  test("deleted file with a 1-line hunk (count defaults to 1)", () => {
    const f = files[2]!;
    expect(f.changeType).toBe("deleted");
    expect(f.path).toBe("gone.txt");
    expect(f.hunks[0]!.oldLines).toBe(1);
    expect(f.hunks[0]!.newLines).toBe(0);
    expect(f.deletions).toBe(1);
  });

  test("renamed file keeps both paths", () => {
    const f = files[3]!;
    expect(f.changeType).toBe("renamed");
    expect(f.path).toBe("new/name.ts");
    expect(f.oldPath).toBe("old/name.ts");
    expect(f.additions).toBe(1);
    expect(f.deletions).toBe(1);
  });

  test("binary file: flagged, no hunks", () => {
    const f = files[4]!;
    expect(f.binary).toBe(true);
    expect(f.hunks).toHaveLength(0);
  });

  test("strips git's trailing-tab terminator from spaced filenames", () => {
    const diff = `diff --git a/with space.ts b/with space.ts
new file mode 100644
index 0000000..9495c3c
--- /dev/null
+++ b/with space.ts\t
@@ -0,0 +1 @@
+space
`;
    expect(parseDiff(diff).map((f) => f.path)).toEqual(["with space.ts"]);
  });

  test("strips the trailing-tab terminator on the --- line of a modified spaced file", () => {
    const diff = `diff --git a/with space.ts b/with space.ts
index 1111111..2222222 100644
--- a/with space.ts\t
+++ b/with space.ts\t
@@ -1 +1 @@
-old
+new
`;
    const f = parseDiff(diff)[0]!;
    expect(f.path).toBe("with space.ts");
    expect(f.oldPath).toBe("with space.ts");
  });
});

describe("languageOf", () => {
  test("maps extensions", () => {
    expect(languageOf("src/a.ts")).toBe("typescript");
    expect(languageOf("src/a.tsx")).toBe("tsx");
    expect(languageOf("README.md")).toBe("markdown");
    expect(languageOf("Makefile")).toBe("text");
    expect(languageOf(".gitignore")).toBe("text");
  });
});

describe("round-trip fidelity against real git diff", () => {
  test("resolved hunk bodies appear verbatim in `git diff` output", () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-difftest-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    try {
      git("init", "-q");
      git("config", "user.email", "t@t.t");
      git("config", "user.name", "t");
      git("config", "commit.gpgsign", "false");

      writeFileSync(join(dir, "keep.ts"), "a\nb\nc\nd\ne\n");
      writeFileSync(join(dir, "drop.ts"), "to be removed\n");
      git("add", "-A");
      git("commit", "-q", "-m", "base");

      // Modified + added + deleted, committed so we exercise all change types
      // via a clean two-commit diff (no index/untracked artifacts).
      writeFileSync(join(dir, "keep.ts"), "a\nB2\nc\nd\nE2\nf\n");
      writeFileSync(join(dir, "added.ts"), "brand new\nsecond\n");
      unlinkSync(join(dir, "drop.ts"));
      git("add", "-A");
      git("commit", "-q", "-m", "change");

      const raw = git("diff", "HEAD~1", "HEAD");
      const files = parseDiff(raw);

      // Every parsed hunk's text must be a verbatim substring of git's output.
      for (const f of files) {
        for (const h of f.hunks) {
          const block = [h.header, ...h.lines].join("\n");
          expect(raw).toContain(block);
        }
      }

      // Stats must equal `git diff --numstat`.
      const numstat = git("diff", "--numstat", "HEAD~1", "HEAD").trim().split("\n");
      const byName = new Map(
        numstat.map((l) => {
          const [add, del, name] = l.split("\t");
          return [name!, { add: Number(add), del: Number(del) }];
        }),
      );
      for (const f of files) {
        const expected = byName.get(f.path);
        expect(expected).toBeDefined();
        expect(f.additions).toBe(expected!.add);
        expect(f.deletions).toBe(expected!.del);
      }
      expect(files.map((f) => f.path).sort()).toEqual(["added.ts", "drop.ts", "keep.ts"].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
