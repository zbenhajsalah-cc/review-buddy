import { describe, expect, test } from "bun:test";
import type { AgentReview, PrMetadata, ReviewMeta } from "../types/review.ts";
import { resolveReview } from "./resolve.ts";

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
diff --git a/logo.png b/logo.png
index 7777777..8888888 100644
Binary files a/logo.png and b/logo.png differ
`;

const META: ReviewMeta = {
  aiGenerated: true,
  generatedBy: "claude-opus-4-8",
  generatedAt: "2026-06-16T12:00:00Z",
  promptVersion: "1",
};

const PR: PrMetadata = {
  title: "t",
  description: "d",
  author: "alice",
  createdAt: "2026-06-16T09:00:00Z",
  base: "main",
  head: "feature",
};

const AGENT: AgentReview = {
  prologue: {
    why: "w",
    what: "x",
    key_changes: [
      { headline: "h1", detail: "d1" },
      { headline: "h2", detail: "d2" },
    ],
    review_focus: { summary: "s", file: "src/dashboard/useSport.ts" },
  },
  chapters: [
    {
      index: 1,
      title: "Null-safe sport",
      risk: "High",
      risk_reason: "central hook",
      additions: 999, // advisory — must be overridden
      deletions: 999,
      description: "guard",
      files: [
        {
          path: "src/dashboard/useSport.ts",
          change_type: "modified",
          hunks: [{ old_start: 12, new_start: 12 }], // only the first hunk
        },
      ],
    },
    {
      index: 2,
      title: "Add fixture",
      risk: "Low",
      risk_reason: "new file",
      description: "adds new.txt",
      files: [{ path: "new.txt", change_type: "added" }], // whole file (hunks omitted)
    },
  ],
};

describe("resolveReview", () => {
  const { review, warnings } = resolveReview(AGENT, SAMPLE, META, PR);

  test("passes through meta, pr, and prologue", () => {
    expect(review.meta).toEqual(META);
    expect(review.pr).toEqual(PR);
    expect(review.prologue.review_focus.file).toBe("src/dashboard/useSport.ts");
  });

  test("attaches the real hunk content for an anchored hunk", () => {
    const ch1 = review.chapters[0]!;
    expect(ch1.fileCount).toBe(1);
    const file = ch1.files[0]!;
    expect(file.old_path).toBeUndefined();
    expect(file.language).toBe("typescript");
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0]!.header).toBe("@@ -12,6 +12,9 @@ export function useSport() {");
    expect(file.hunks[0]!.lines).toContain("+  return user?.sport ?? sports[0];");
  });

  test("recomputes chapter stats from the real diff (ignores advisory)", () => {
    const ch1 = review.chapters[0]!;
    expect(ch1.additions).toBe(3); // not 999
    expect(ch1.deletions).toBe(1);
  });

  test("omitted hunks => whole file", () => {
    const ch2 = review.chapters[1]!;
    expect(ch2.files[0]!.path).toBe("new.txt");
    expect(ch2.files[0]!.additions).toBe(2);
  });

  test("unclaimed changes land in an Unsorted chapter (nothing dropped)", () => {
    const unsorted = review.chapters.find((c) => c.title === "Unsorted changes");
    expect(unsorted).toBeDefined();
    const paths = unsorted!.files.map((f) => f.path).sort();
    // useSport hunk 2 (leftover) + gone.txt; logo.png is noise → separate chapter
    expect(paths).toEqual(["gone.txt", "src/dashboard/useSport.ts"]);
    expect(unsorted!.index).toBe(3);
    expect(warnings.some((w) => w.includes("Unsorted"))).toBe(true);
    expect(review.warnings).toEqual(warnings);

    const noise = review.chapters.find((c) => c.title === "Generated & noise files");
    expect(noise).toBeDefined();
    expect(noise!.files.map((f) => f.path)).toEqual(["logo.png"]);
    expect(noise!.index).toBe(4);
  });

  test("overall stats reflect the entire diff", () => {
    expect(review.stats).toEqual({ additions: 6, deletions: 3, filesChanged: 4 });
  });
});

describe("resolveReview — index normalization", () => {
  const TWO_HUNK_DIFF = `diff --git a/multi.ts b/multi.ts
index 1111111..2222222 100644
--- a/multi.ts
+++ b/multi.ts
@@ -1,3 +1,4 @@
 a
-b
+b1
 c
@@ -10,3 +11,4 @@
 x
-y
+y1
 z
`;

  test("duplicate chapter indices normalize to 1..N and claim distinct hunks", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [
        {
          index: 7,
          title: "First hunk",
          risk: "Low",
          risk_reason: "test",
          description: "claims first hunk",
          files: [
            {
              path: "multi.ts",
              change_type: "modified",
              hunks: [{ old_start: 1, new_start: 1 }],
            },
          ],
        },
        {
          index: 7,
          title: "Second hunk",
          risk: "Low",
          risk_reason: "test",
          description: "claims second hunk",
          files: [
            {
              path: "multi.ts",
              change_type: "modified",
              hunks: [{ old_start: 10, new_start: 10 }],
            },
          ],
        },
      ],
    };
    const { review, warnings } = resolveReview(agent, TWO_HUNK_DIFF, META, PR);

    expect(review.chapters[0]!.index).toBe(1);
    expect(review.chapters[1]!.index).toBe(2);
    expect(review.chapters[0]!.files[0]!.hunks[0]!.old_start).toBe(1);
    expect(review.chapters[1]!.files[0]!.hunks[0]!.old_start).toBe(10);
    expect(warnings.some((w) => w.includes("normalized to"))).toBe(true);
  });
});

describe("resolveReview — within-chapter dedup", () => {
  const TWO_HUNK_DIFF = `diff --git a/multi.ts b/multi.ts
index 1111111..2222222 100644
--- a/multi.ts
+++ b/multi.ts
@@ -1,3 +1,4 @@
 a
-b
+b1
 c
@@ -10,3 +11,4 @@
 x
-y
+y1
 z
`;

  test("same path listed twice in one chapter merges into a single file", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [
        {
          index: 1,
          title: "Both hunks, listed twice",
          risk: "Low",
          risk_reason: "test",
          description: "same path appears twice",
          files: [
            { path: "multi.ts", change_type: "modified", hunks: [{ old_start: 1, new_start: 1 }] },
            {
              path: "multi.ts",
              change_type: "modified",
              hunks: [{ old_start: 10, new_start: 10 }],
            },
          ],
        },
      ],
    };
    const { review } = resolveReview(agent, TWO_HUNK_DIFF, META, PR);
    const ch1 = review.chapters[0]!;
    expect(ch1.fileCount).toBe(1);
    expect(ch1.files.filter((f) => f.path === "multi.ts")).toHaveLength(1);
    expect(ch1.files[0]!.hunks).toHaveLength(2);
    expect(ch1.files[0]!.hunks.map((h) => h.old_start)).toEqual([1, 10]);
  });
});

describe("resolveReview — fidelity", () => {
  const RENAME_SECTION = `diff --git a/old-name.ts b/new-name.ts
similarity index 90%
rename from old-name.ts
rename to new-name.ts
index 5555555..6666666 100644
--- a/old-name.ts
+++ b/new-name.ts
@@ -1,2 +1,2 @@
-a
+b
 c
`;

  test("all anchors miss => no empty chapter entry; hunks land in Unsorted", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [
        {
          index: 1,
          title: "Missed anchors",
          risk: "Low",
          risk_reason: "test",
          description: "anchors do not match",
          files: [
            {
              path: "src/dashboard/useSport.ts",
              change_type: "modified",
              hunks: [{ old_start: 999, new_start: 999 }],
            },
          ],
        },
      ],
    };
    const { review, warnings } = resolveReview(agent, SAMPLE, META, PR);

    const ch1 = review.chapters.find((c) => c.index === 1);
    expect(ch1).toBeDefined();
    expect(ch1!.fileCount).toBe(0);
    expect(ch1!.files.some((f) => f.path === "src/dashboard/useSport.ts")).toBe(false);

    const unsorted = review.chapters.find((c) => c.title === "Unsorted changes");
    expect(unsorted).toBeDefined();
    const sport = unsorted!.files.find((f) => f.path === "src/dashboard/useSport.ts");
    expect(sport).toBeDefined();
    expect(sport!.hunks).toHaveLength(2);

    expect(warnings).toContain(
      'Chapter 1: none of the anchors for "src/dashboard/useSport.ts" matched — ' +
        'its changes will appear under "Unsorted changes".',
    );
  });

  test("binary file carry-through => binary flag, no Unsorted duplicate", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [
        {
          index: 1,
          title: "Logo",
          risk: "Low",
          risk_reason: "binary asset",
          description: "logo update",
          files: [{ path: "logo.png", change_type: "modified" }],
        },
      ],
    };
    const { review } = resolveReview(agent, SAMPLE, META, PR);

    const ch1 = review.chapters.find((c) => c.index === 1);
    expect(ch1).toBeDefined();
    const logo = ch1!.files.find((f) => f.path === "logo.png");
    expect(logo).toBeDefined();
    expect(logo!.binary).toBe(true);
    expect(logo!.hunks).toHaveLength(0);

    const unsorted = review.chapters.find((c) => c.title === "Unsorted changes");
    expect(unsorted?.files.some((f) => f.path === "logo.png") ?? false).toBe(false);
  });

  test("rename carry-through => old_path on resolved file", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [
        {
          index: 1,
          title: "Rename",
          risk: "Low",
          risk_reason: "file rename",
          description: "renamed file",
          files: [{ path: "new-name.ts", change_type: "renamed" }],
        },
      ],
    };
    const { review } = resolveReview(agent, SAMPLE + RENAME_SECTION, META, PR);

    const ch1 = review.chapters.find((c) => c.index === 1);
    expect(ch1).toBeDefined();
    const renamed = ch1!.files.find((f) => f.path === "new-name.ts");
    expect(renamed).toBeDefined();
    expect(renamed!.change_type).toBe("renamed");
    expect(renamed!.old_path).toBe("old-name.ts");
  });

  test("partial anchor miss => file in both the chapter and Unsorted", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [
        {
          index: 1,
          title: "Partial",
          risk: "Low",
          risk_reason: "one anchor hits, one misses",
          description: "partial anchor match",
          files: [
            {
              path: "src/dashboard/useSport.ts",
              change_type: "modified",
              // first anchor matches the @@ -12 hunk; second matches nothing
              hunks: [
                { old_start: 12, new_start: 12 },
                { old_start: 999, new_start: 999 },
              ],
            },
          ],
        },
      ],
    };
    const { review, warnings } = resolveReview(agent, SAMPLE, META, PR);

    // Chapter keeps the one matched hunk.
    const ch1 = review.chapters.find((c) => c.index === 1);
    expect(ch1).toBeDefined();
    const inChapter = ch1!.files.find((f) => f.path === "src/dashboard/useSport.ts");
    expect(inChapter).toBeDefined();
    expect(inChapter!.hunks).toHaveLength(1);

    // The unmatched hunk still lands in Unsorted under the SAME path.
    const unsorted = review.chapters.find((c) => c.title === "Unsorted changes");
    expect(unsorted).toBeDefined();
    const inUnsorted = unsorted!.files.find((f) => f.path === "src/dashboard/useSport.ts");
    expect(inUnsorted).toBeDefined();
    expect(inUnsorted!.hunks).toHaveLength(1);

    // Partial miss => per-anchor warning fires, but NOT the total-miss summary.
    expect(warnings.some((w) => w.includes("(old 999, new 999)"))).toBe(true);
    expect(warnings.some((w) => w.includes("none of the anchors"))).toBe(false);
  });
});

describe("resolveReview — noise bucket", () => {
  const LOCKFILE_DIFF = `diff --git a/package-lock.json b/package-lock.json
index 1111111..2222222 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,2 +1,3 @@
 {
-  "lockfileVersion": 2
+  "lockfileVersion": 3,
+  "packages": {}
 }
`;

  const SOURCE_DIFF = `diff --git a/src/util.ts b/src/util.ts
index 1111111..2222222 100644
--- a/src/util.ts
+++ b/src/util.ts
@@ -1,2 +1,3 @@
 export const x = 1;
+export const y = 2;
`;

  const BOTH_DIFF = LOCKFILE_DIFF + SOURCE_DIFF;

  test("unclaimed lockfile goes to Generated & noise files, not Unsorted", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [
        {
          index: 1,
          title: "Only source",
          risk: "Low",
          risk_reason: "test",
          description: "claims the source file",
          files: [{ path: "src/util.ts", change_type: "modified" }],
        },
      ],
    };
    const { review, warnings } = resolveReview(agent, BOTH_DIFF, META, PR);

    const noise = review.chapters.find((c) => c.title === "Generated & noise files");
    expect(noise).toBeDefined();
    expect(noise!.files.map((f) => f.path)).toEqual(["package-lock.json"]);
    expect(noise!.risk).toBe("Low");
    expect(noise!.risk_reason).toBe("Generated or binary artifacts — not hand-written code.");

    const unsorted = review.chapters.find((c) => c.title === "Unsorted changes");
    expect(unsorted).toBeUndefined();
    expect(warnings.some((w) => w.includes("Unsorted"))).toBe(false);
    expect(warnings.some((w) => w.includes("Generated") || w.includes("noise"))).toBe(false);
  });

  test("unclaimed .ts file still goes to Unsorted and still warns", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [
        {
          index: 1,
          title: "Empty claim",
          risk: "Low",
          risk_reason: "test",
          description: "claims nothing real",
          files: [{ path: "does-not-exist.ts", change_type: "modified" }],
        },
      ],
    };
    const { review, warnings } = resolveReview(agent, SOURCE_DIFF, META, PR);

    const unsorted = review.chapters.find((c) => c.title === "Unsorted changes");
    expect(unsorted).toBeDefined();
    expect(unsorted!.files.map((f) => f.path)).toEqual(["src/util.ts"]);
    expect(warnings.some((w) => w.includes("Unsorted"))).toBe(true);
    expect(warnings.some((w) => w.includes("1 file(s)"))).toBe(true);

    expect(review.chapters.find((c) => c.title === "Generated & noise files")).toBeUndefined();
  });

  test("agent-assigned lockfile stays in its chapter; no synthetic noise chapter", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [
        {
          index: 1,
          title: "Deps",
          risk: "Low",
          risk_reason: "lockfile bump",
          description: "intentionally includes the lockfile",
          files: [{ path: "package-lock.json", change_type: "modified" }],
        },
      ],
    };
    const { review, warnings } = resolveReview(agent, LOCKFILE_DIFF, META, PR);

    const ch1 = review.chapters.find((c) => c.index === 1);
    expect(ch1!.files.map((f) => f.path)).toEqual(["package-lock.json"]);
    expect(review.chapters.find((c) => c.title === "Generated & noise files")).toBeUndefined();
    expect(review.chapters.find((c) => c.title === "Unsorted changes")).toBeUndefined();
    expect(warnings.some((w) => w.includes("Unsorted"))).toBe(false);
    expect(warnings.some((w) => w.includes("Generated") || w.includes("noise"))).toBe(false);
  });

  test("both buckets non-empty => both chapters, sequential indices, noise last", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [
        {
          index: 1,
          title: "Placeholder",
          risk: "Low",
          risk_reason: "test",
          description: "claims a missing file so both real files are unclaimed",
          files: [{ path: "missing.ts", change_type: "modified" }],
        },
      ],
    };
    const { review, warnings } = resolveReview(agent, BOTH_DIFF, META, PR);

    const unsorted = review.chapters.find((c) => c.title === "Unsorted changes");
    const noise = review.chapters.find((c) => c.title === "Generated & noise files");
    expect(unsorted).toBeDefined();
    expect(noise).toBeDefined();
    expect(unsorted!.files.map((f) => f.path)).toEqual(["src/util.ts"]);
    expect(noise!.files.map((f) => f.path)).toEqual(["package-lock.json"]);
    expect(unsorted!.index).toBe(2);
    expect(noise!.index).toBe(3);

    // warnings[] fires for unsorted only — never for the noise bucket
    expect(warnings.filter((w) => w.includes("Unsorted"))).toHaveLength(1);
    expect(warnings.some((w) => w.includes("Generated") || w.includes("noise"))).toBe(false);
  });

  test("warnings[] contains no entry for the noise bucket", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [],
    };
    const { warnings } = resolveReview(agent, LOCKFILE_DIFF, META, PR);
    expect(warnings).toEqual([]);
  });

  test("all anchors miss on a noise file => warning names Generated & noise files", () => {
    const agent: AgentReview = {
      prologue: AGENT.prologue,
      chapters: [
        {
          index: 1,
          title: "Missed lockfile anchors",
          risk: "Low",
          risk_reason: "test",
          description: "anchors do not match a noise file",
          files: [
            {
              path: "package-lock.json",
              change_type: "modified",
              hunks: [{ old_start: 999, new_start: 999 }],
            },
          ],
        },
      ],
    };
    const { review, warnings } = resolveReview(agent, LOCKFILE_DIFF, META, PR);

    const ch1 = review.chapters.find((c) => c.index === 1);
    expect(ch1).toBeDefined();
    expect(ch1!.fileCount).toBe(0);

    const noise = review.chapters.find((c) => c.title === "Generated & noise files");
    expect(noise).toBeDefined();
    expect(noise!.files.map((f) => f.path)).toEqual(["package-lock.json"]);
    expect(noise!.files[0]!.hunks).toHaveLength(1);

    expect(review.chapters.find((c) => c.title === "Unsorted changes")).toBeUndefined();

    expect(warnings).toContain(
      'Chapter 1: none of the anchors for "package-lock.json" matched — ' +
        'its changes will appear under "Generated & noise files".',
    );
  });
});
