import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openGitHubPr } from "./api-source.ts";
import type { FetchFn } from "./auth.ts";
import { parsePrArg, runPrCheck } from "./pr-check.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const API = "https://api.github.com/repos/zbenhajsalah-cc/review-buddy";

test("parsePrArg takes owner/repo#n or a PR URL", () => {
  const ref = { owner: "octo", repo: "hello.world", number: 7 };
  expect(parsePrArg("octo/hello.world#7")).toEqual(ref);
  expect(parsePrArg("https://github.com/octo/hello.world/pull/7")).toEqual(ref);
  expect(parsePrArg(" https://github.com/octo/hello.world/pull/7/ ")).toEqual(ref);
  for (const bad of ["octo/hello", "#7", "https://evil.example/octo/x/pull/7", "../x/y#1"]) {
    expect(() => parsePrArg(bad)).toThrow();
  }
});

/** The recorded PR #28, as GitHub answered it (see fixtures/README.md). */
const recorded: FetchFn = async (url, init) => {
  const accept = new Headers(init?.headers).get("accept");
  if (url === `${API}/pulls/28`) {
    return accept === "application/vnd.github.diff"
      ? new Response(fixture("pr-28.diff"))
      : Response.json(JSON.parse(fixture("pr-28.json")));
  }
  if (url.startsWith(`${API}/compare/`))
    return Response.json(JSON.parse(fixture("compare-page2.json")));
  if (url.includes("/contents/packages/viewer/src/ReviewViewer.tsx?ref=7e8e705")) {
    return new Response(fixture("ReviewViewer.tsx@7e8e705.txt"));
  }
  if (url.includes("/contents/packages/viewer/src/ReviewViewer.tsx?ref=dd0aba0")) {
    return new Response(fixture("ReviewViewer.tsx@dd0aba0.txt"));
  }
  return new Response("{}", { status: 404 });
};

test("runPrCheck summarizes a PR it could read", async () => {
  const ref = parsePrArg("zbenhajsalah-cc/review-buddy#28");
  const result = await runPrCheck(() =>
    openGitHubPr(ref, { fetch: recorded, token: async () => "t" }),
  );
  expect(result).toMatchObject({
    ok: true,
    pr: { author: "zbenhajsalah-cc", base: "develop" },
    diff: { files: 4, additions: 35, deletions: 5 },
  });
  // The first modified text file is the built index.html (not recorded: 404 → "").
  expect(result.fileRead?.path).toBe("apps/plugin/ui/dist/index.html");
});

test("runPrCheck names a too-large PR", async () => {
  const tooLarge: FetchFn = async (url, init) =>
    new Headers(init?.headers).get("accept") === "application/vnd.github.diff"
      ? new Response(fixture("pr-diff-too-large-406.json"), { status: 406 })
      : recorded(url, init);
  const ref = parsePrArg("zbenhajsalah-cc/review-buddy#28");
  const result = await runPrCheck(() =>
    openGitHubPr(ref, { fetch: tooLarge, token: async () => "t" }),
  );
  expect(result).toMatchObject({ ok: false, errorKind: "too_large" });
});

test("runPrCheck reports when not signed in", async () => {
  const result = await runPrCheck(async () => {
    throw new Error("Not signed in to GitHub.");
  });
  expect(result).toMatchObject({
    ok: false,
    error: "Not signed in to GitHub.",
    errorKind: "other",
  });
});
