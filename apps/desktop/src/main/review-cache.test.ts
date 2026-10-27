import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixtureReview } from "./fixture/index.ts";
import { parseLabel, ReviewCache, reviewKeyOf } from "./review-cache.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "rb-cache-"));
  dirs.push(dir);
  let clock = Date.parse("2026-10-27T10:00:00Z");
  // Each save is one minute after the one before.
  const now = () => {
    clock += 60_000;
    return new Date(clock);
  };
  const cache = new ReviewCache(dir, now);
  await cache.load();
  const { review } = await loadFixtureReview();
  const save = (pr: string, headSha: string) =>
    cache.save({
      pr,
      headSha,
      baseSha: A,
      files: [{ path: "src/retry.ts", changeType: "modified", binary: false }],
      review,
    });
  const reopen = async () => {
    const again = new ReviewCache(dir, now);
    await again.load();
    return again;
  };
  return { dir, cache, save, reopen, review };
}

test("parseLabel and reviewKeyOf", () => {
  expect(parseLabel("octo/repo#12")).toEqual({ owner: "octo", repo: "repo", number: 12 });
  for (const bad of [
    "octo/repo",
    "../x/repo#1",
    "octo/..#1",
    "octo/repo#0",
    "o/r/x#1",
    "a b/c#1",
  ]) {
    expect(parseLabel(bad)).toBeNull();
  }
  expect(reviewKeyOf("octo/repo#12", B)).toBe("octo/repo#12@bbbbbbbbbbbb");
});

describe("ReviewCache", () => {
  test("a saved review is listed, found and read back after a restart", async () => {
    const { dir, save, reopen, review } = await setup();
    const key = await save("Octo/Repo#12", B);
    expect(key).toBe("Octo/Repo#12@bbbbbbbbbbbb");
    // One file per PR head, under lower-case owner and repo.
    expect(existsSync(join(dir, "octo", "repo", `12@${B}.json`))).toBe(true);

    const cache = await reopen();
    const [info] = cache.list();
    expect(info).toMatchObject({
      reviewKey: key,
      pr: "Octo/Repo#12",
      title: review.pr.title,
      headSha: B,
      savedAt: "2026-10-27T10:01:00.000Z",
    });
    expect(info!.bytes).toBeGreaterThan(1000);
    expect(cache.newestFor("octo/repo#12")).toEqual({ reviewKey: key, headSha: B });
    expect(cache.find("octo/repo#12", B)).toBe(key);
    expect(cache.find("octo/repo#12", A)).toBeUndefined();
    const saved = await cache.read(key);
    expect(saved).toMatchObject({ version: 1, pr: "Octo/Repo#12", headSha: B, baseSha: A });
    expect(saved!.review).toEqual(review);
    expect(saved!.files).toEqual([{ path: "src/retry.ts", changeType: "modified", binary: false }]);
  });

  test("newest first; another head is another review; the same head replaces", async () => {
    const { save, cache } = await setup();
    await save("octo/repo#12", A);
    await save("octo/repo#7", A);
    const newer = await save("octo/repo#12", B);
    expect(cache.newestFor("octo/repo#12")).toEqual({ reviewKey: newer, headSha: B });
    await save("OCTO/repo#12", B); // same head, another spelling
    expect(cache.list().map((i) => i.reviewKey)).toEqual([
      "OCTO/repo#12@bbbbbbbbbbbb",
      "octo/repo#7@aaaaaaaaaaaa",
      "octo/repo#12@aaaaaaaaaaaa",
    ]);
  });

  test("delete and deleteAll remove the files", async () => {
    const { dir, save, cache, reopen } = await setup();
    const one = await save("octo/repo#12", A);
    await save("octo/other#3", B);
    expect(await cache.delete(one)).toBe(true);
    expect(await cache.delete(one)).toBe(false);
    expect(await cache.delete({})).toBe(false);
    expect(existsSync(join(dir, "octo", "repo", `12@${A}.json`))).toBe(false);
    expect((await reopen()).list().map((i) => i.pr)).toEqual(["octo/other#3"]);
    await cache.deleteAll();
    expect(cache.list()).toEqual([]);
    expect(existsSync(dir)).toBe(false);
    expect((await reopen()).list()).toEqual([]);
  });

  test("a damaged or missing file is dropped; a bad index entry is ignored", async () => {
    const { dir, save, reopen } = await setup();
    const damaged = await save("octo/repo#1", A);
    const missing = await save("octo/repo#2", A);
    await save("octo/repo#3", A);
    writeFileSync(join(dir, "octo", "repo", `1@${A}.json`), "{ not json");
    rmSync(join(dir, "octo", "repo", `2@${A}.json`));
    // An index entry that would point outside the folder.
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    index.push({ ...index[0], pr: "../../etc#1", reviewKey: reviewKeyOf("../../etc#1", A) });
    writeFileSync(join(dir, "index.json"), JSON.stringify(index));

    const cache = await reopen();
    expect(cache.list().map((i) => i.pr)).toEqual(["octo/repo#3", "octo/repo#1"]);
    expect(await cache.read(damaged)).toBeUndefined();
    expect(await cache.read(missing)).toBeUndefined();
    expect(cache.list().map((i) => i.pr)).toEqual(["octo/repo#3"]);
    expect(await cache.read("nope")).toBeUndefined();
  });

  test("no index yet, or a damaged one: empty", async () => {
    const { dir, reopen } = await setup();
    expect((await reopen()).list()).toEqual([]);
    writeFileSync(join(dir, "index.json"), "[oops");
    expect((await reopen()).list()).toEqual([]);
  });

  test("a review of an unsafe PR name or SHA is never written", async () => {
    const { cache, review } = await setup();
    await expect(
      cache.save({ pr: "../x#1", headSha: A, baseSha: A, files: [], review }),
    ).rejects.toThrow("Cannot save");
    await expect(
      cache.save({ pr: "octo/repo#1", headSha: "main", baseSha: A, files: [], review }),
    ).rejects.toThrow("Cannot save");
    expect(cache.list()).toEqual([]);
  });
});
