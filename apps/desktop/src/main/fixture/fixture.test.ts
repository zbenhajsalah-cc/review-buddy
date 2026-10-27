import { expect, test } from "bun:test";
import { parseDiff } from "@review-buddy/core/diff";
import { fixtureSource, loadFixtureReview } from "./index.ts";

test("the fixture review resolves cleanly through core", async () => {
  const { review, warnings } = await loadFixtureReview();
  expect(warnings).toEqual([]);
  expect(review.chapters.map((c) => c.title)).toEqual([
    "Retry backoff with jitter",
    "Greeting suffix",
  ]);
  expect(review.stats).toEqual({ additions: 17, deletions: 3, filesChanged: 3 });
});

// The diff must describe exactly the stored file bytes, or "Expand full file"
// would show lines that disagree with the diff.
test("the fixture diff matches the fixture files", async () => {
  const source = fixtureSource();
  for (const file of parseDiff(await source.diff())) {
    const base = (await source.fileContent(file.path, "base")).split("\n");
    const head = (await source.fileContent(file.path, "head")).split("\n");
    for (const hunk of file.hunks) {
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      for (const line of hunk.lines) {
        const text = line.slice(1);
        if (line[0] !== "+") expect(base[oldLine++ - 1]).toBe(text);
        if (line[0] !== "-") expect(head[newLine++ - 1]).toBe(text);
      }
    }
  }
});
