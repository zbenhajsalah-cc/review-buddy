import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureSource, loadFixtureReview } from "./fixture/index.ts";
import { ReviewCache } from "./review-cache.ts";
import { parseDoneResult, ReviewStore } from "./reviews.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function cacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rb-store-"));
  dirs.push(dir);
  return dir;
}

async function store() {
  const s = new ReviewStore();
  const { review, source } = await loadFixtureReview();
  s.add("fixture", review, source);
  return s;
}

describe("ReviewStore", () => {
  test("newestFor and find: the PR reviews added, any case", async () => {
    const s = await store();
    const { review, source } = await loadFixtureReview();
    const pr = (headSha: string) => ({ label: "octo/repo#1", headSha, baseSha: A, files: [] });
    expect(s.newestFor("octo/repo#1")).toBeUndefined();
    expect(await s.addPrReview(review, source, pr(A))).toBe(`octo/repo#1@${"a".repeat(12)}`);
    const keyB = await s.addPrReview(review, source, pr(B));
    expect(s.newestFor("Octo/Repo#1")).toEqual({ reviewKey: keyB, headSha: B });
    expect(s.find("octo/repo#1", B)).toBe(keyB);
    expect(s.find("octo/repo#1", A)).toBeUndefined(); // not saved: only the newest is known
    // Older reviews still load.
    expect(await s.getReview(`octo/repo#1@${"a".repeat(12)}`)).toBe(review);
  });

  test("saved PR reviews come back after a restart, with their file reads", async () => {
    const dir = cacheDir();
    const { review, source } = await loadFixtureReview();
    const reopened: string[] = [];
    const open = async () => {
      const cache = new ReviewCache(dir);
      await cache.load();
      return new ReviewStore({
        cache,
        reopen: (saved) => {
          reopened.push(`${saved.pr} ${saved.baseSha.slice(0, 3)} ${saved.files.length}`);
          return source;
        },
      });
    };
    const first = await open();
    const files = [{ path: "src/retry.ts", changeType: "modified" as const, binary: false }];
    const key = await first.addPrReview(review, source, {
      label: "octo/repo#1",
      headSha: B,
      baseSha: A,
      files,
    });

    const second = await open();
    expect(second.newestFor("octo/repo#1")).toEqual({ reviewKey: key, headSha: B });
    expect(second.find("octo/repo#1", B)).toBe(key);
    expect((await second.getReview(key)).pr.title).toBe(review.pr.title);
    expect((await second.getFileContent(key, "src/retry.ts", "head")).content).toBe(
      await source.fileContent("src/retry.ts", "head"),
    );
    expect(reopened).toEqual(["octo/repo#1 aaa 1"]); // once, then kept in memory
    expect(second.saved().map((s) => s.reviewKey)).toEqual([key]);

    await second.delete(key);
    await expect(second.getReview(key)).rejects.toThrow("unknown review");
    expect(second.newestFor("octo/repo#1")).toBeUndefined();
    const third = await open();
    expect(third.saved()).toEqual([]);
  });

  test("delete refuses the sample and non-strings; deleteAll keeps the sample", async () => {
    const s = await store();
    const { review, source } = await loadFixtureReview();
    await s.addPrReview(review, source, {
      label: "octo/repo#1",
      headSha: A,
      baseSha: A,
      files: [],
    });
    await expect(s.delete("fixture")).rejects.toThrow("unknown review");
    await expect(s.delete(42)).rejects.toThrow("unknown review");
    await s.deleteAll();
    expect(s.newestFor("octo/repo#1")).toBeUndefined();
    expect((await s.getReview("fixture")).pr.title).toBe(review.pr.title);
  });

  test("serves a review by key", async () => {
    const s = await store();
    expect((await s.getReview("fixture")).pr.title).toBe("Friendlier greetings and calmer retries");
  });

  test("refuses unknown or non-string review keys", async () => {
    const s = await store();
    await expect(s.getReview("other")).rejects.toThrow("unknown review");
    await expect(s.getReview(undefined)).rejects.toThrow("unknown review");
    await expect(s.getReview({ toString: () => "fixture" })).rejects.toThrow("unknown review");
  });

  test("serves the review's own files, with their language", async () => {
    const s = await store();
    const head = await s.getFileContent("fixture", "src/retry.ts", "head");
    expect(head).toMatchObject({ path: "src/retry.ts", side: "head", language: "typescript" });
    expect(head.content).toBe(await fixtureSource().fileContent("src/retry.ts", "head"));
    const base = await s.getFileContent("fixture", "src/retry.ts", "base");
    expect(base.content).toContain("[100, 200, 400, 800]");
  });

  test("an added file has no base bytes", async () => {
    const s = await store();
    expect((await s.getFileContent("fixture", "test/greet.test.ts", "base")).content).toBe("");
  });

  test("refuses paths outside the review", async () => {
    const s = await store();
    for (const path of ["../package.json", "src/other.ts", "/etc/passwd", 42]) {
      await expect(s.getFileContent("fixture", path, "head")).rejects.toThrow("unknown path");
    }
  });

  test("any side other than base reads head", async () => {
    const s = await store();
    expect((await s.getFileContent("fixture", "src/retry.ts", "HEAD;rm")).side).toBe("head");
  });
});

describe("parseDoneResult", () => {
  test("keeps the known fields", () => {
    expect(parseDoneResult(undefined)).toEqual({});
    expect(parseDoneResult({ verdict: "approve", extra: 1 })).toEqual({ verdict: "approve" });
    expect(parseDoneResult({ verdict: "request_changes", summary: "fix it" })).toEqual({
      verdict: "request_changes",
      summary: "fix it",
    });
  });

  test("refuses bad values", () => {
    expect(() => parseDoneResult("approve")).toThrow();
    expect(() => parseDoneResult({ verdict: "merge" })).toThrow("invalid verdict");
    expect(() => parseDoneResult({ summary: 5 })).toThrow("invalid summary");
    expect(() => parseDoneResult({ summary: "x".repeat(256 * 1024 + 1) })).toThrow(
      "invalid summary",
    );
  });
});
