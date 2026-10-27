import { describe, expect, test } from "bun:test";
import { fixtureSource, loadFixtureReview } from "./fixture/index.ts";
import { parseDoneResult, ReviewStore } from "./reviews.ts";

async function store() {
  const s = new ReviewStore();
  const { review, source } = await loadFixtureReview();
  s.add("fixture", review, source);
  return s;
}

describe("ReviewStore", () => {
  test("serves a review by key", async () => {
    const s = await store();
    expect(s.getReview("fixture").pr.title).toBe("Friendlier greetings and calmer retries");
  });

  test("refuses unknown or non-string review keys", async () => {
    const s = await store();
    expect(() => s.getReview("other")).toThrow("unknown review");
    expect(() => s.getReview(undefined)).toThrow("unknown review");
    expect(() => s.getReview({ toString: () => "fixture" })).toThrow("unknown review");
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
