import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDiff } from "@review-buddy/core/diff";
import {
  encodePath,
  IncompleteDiffError,
  MAX_FILE_BYTES,
  openGitHubPr,
  PrTooLargeError,
  parsePrRef,
} from "./api-source.ts";
import type { FetchFn } from "./auth.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

const API = "https://api.github.com/repos/zbenhajsalah-cc/review-buddy";
const BASE = "dd0aba03f871da744fe6bc349f93ad9a3ab5b1ba";
const HEAD = "7e8e70534d5fdb0a8ef1a5a0bf8407774b007b00";
const JSON_ACCEPT = "application/vnd.github+json";
const DIFF = "application/vnd.github.diff";
const RAW = "application/vnd.github.raw+json";
const REF = { owner: "zbenhajsalah-cc", repo: "review-buddy", number: 28 };

type Route = () => Response;

/** A fake GitHub answering from the recorded fixtures, keyed by "accept url". */
function fakeGitHub(overrides: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    [`${JSON_ACCEPT} ${API}/pulls/28`]: () => Response.json(JSON.parse(fixture("pr-28.json"))),
    [`${JSON_ACCEPT} ${API}/compare/${BASE}...${HEAD}?per_page=1&page=2`]: () =>
      Response.json(JSON.parse(fixture("compare-page2.json"))),
    [`${DIFF} ${API}/pulls/28`]: () => new Response(fixture("pr-28.diff")),
    [`${RAW} ${API}/contents/packages/viewer/src/ReviewViewer.tsx?ref=${HEAD}`]: () =>
      new Response(fixture("ReviewViewer.tsx@7e8e705.txt")),
    [`${RAW} ${API}/contents/packages/viewer/src/ReviewViewer.tsx?ref=${BASE}`]: () =>
      new Response(fixture("ReviewViewer.tsx@dd0aba0.txt")),
    ...overrides,
  };
  const calls: { key: string; auth: string | null }[] = [];
  const fetch: FetchFn = async (url, init) => {
    const headers = new Headers(init?.headers);
    const key = `${headers.get("accept")} ${url}`;
    calls.push({ key, auth: headers.get("authorization") });
    const route = routes[key];
    return route
      ? route()
      : Response.json(JSON.parse(fixture("contents-404.json")), { status: 404 });
  };
  return { fetch, calls };
}

const open = (gh = fakeGitHub(), ref = REF) =>
  openGitHubPr(ref, { fetch: gh.fetch, token: async () => "ghp_test" });

describe("openGitHubPr (recorded responses)", () => {
  test("PR metadata, head SHA and merge base", async () => {
    const source = await open();
    expect(await source.pr()).toEqual({
      title: "fix(viewer): start fresh when ReviewViewer gets another review",
      description:
        "A new review remounts the screens, so per-review file flags are not saved under the next review's key.",
      author: "zbenhajsalah-cc",
      createdAt: "2026-10-27T10:12:00Z",
      base: "develop",
      head: "claude/diff-chunking-web-app-38w6f7",
      url: "https://github.com/zbenhajsalah-cc/review-buddy/pull/28",
      headRefOid: HEAD,
    });
    expect(source.headSha).toBe(HEAD);
    expect(source.baseSha).toBe(BASE);
  });

  test("the diff is GitHub's, read once, and parses into the PR's 4 files", async () => {
    const gh = fakeGitHub();
    const source = await open(gh);
    const diff = await source.diff();
    expect(diff).toBe(fixture("pr-28.diff"));
    await source.diff();
    await source.fileContent("packages/viewer/src/ReviewViewer.tsx", "head");
    expect(gh.calls.filter((c) => c.key.startsWith(DIFF))).toHaveLength(1);
    const files = parseDiff(diff);
    expect(files.map((f) => [f.path, f.changeType])).toEqual([
      ["apps/plugin/ui/dist/assets/index-GF0bpV26.js", "renamed"],
      ["apps/plugin/ui/dist/index.html", "modified"],
      ["packages/viewer/src/ReviewViewer.test.tsx", "modified"],
      ["packages/viewer/src/ReviewViewer.tsx", "modified"],
    ]);
  });

  test("every call carries the token", async () => {
    const gh = fakeGitHub();
    const source = await open(gh);
    await source.diff();
    expect(gh.calls.every((c) => c.auth === "Bearer ghp_test")).toBe(true);
  });

  test("file bytes: head at the head SHA, base at the merge base", async () => {
    const source = await open();
    const path = "packages/viewer/src/ReviewViewer.tsx";
    expect(await source.fileContent(path, "head")).toBe(fixture("ReviewViewer.tsx@7e8e705.txt"));
    expect(await source.fileContent(path, "base")).toBe(fixture("ReviewViewer.tsx@dd0aba0.txt"));
  });

  test("a renamed file is read under its old name on the base side", async () => {
    const gh = fakeGitHub({
      [`${RAW} ${API}/contents/apps/plugin/ui/dist/assets/index-B73tPl86.js?ref=${BASE}`]: () =>
        new Response("old bytes"),
    });
    const source = await open(gh);
    expect(await source.fileContent("apps/plugin/ui/dist/assets/index-GF0bpV26.js", "base")).toBe(
      "old bytes",
    );
  });

  test("only the PR's own files are read", async () => {
    const gh = fakeGitHub();
    const source = await open(gh);
    for (const path of ["package.json", "../secrets", "packages/viewer/src/index.ts"]) {
      await expect(source.fileContent(path, "head")).rejects.toThrow("unknown path");
    }
    expect(gh.calls.some((c) => c.key.includes("/contents/"))).toBe(false);
  });

  test("a file GitHub does not have (404) is unavailable: empty", async () => {
    const gh = fakeGitHub({
      [`${RAW} ${API}/contents/packages/viewer/src/ReviewViewer.tsx?ref=${HEAD}`]: () =>
        Response.json(JSON.parse(fixture("contents-404.json")), { status: 404 }),
    });
    expect(await (await open(gh)).fileContent("packages/viewer/src/ReviewViewer.tsx", "head")).toBe(
      "",
    );
  });

  test("a file over the size limit is unavailable", async () => {
    const gh = fakeGitHub({
      [`${RAW} ${API}/contents/packages/viewer/src/ReviewViewer.tsx?ref=${HEAD}`]: () =>
        new Response("x", { headers: { "content-length": String(MAX_FILE_BYTES + 1) } }),
    });
    expect(await (await open(gh)).fileContent("packages/viewer/src/ReviewViewer.tsx", "head")).toBe(
      "",
    );
  });

  test("other GitHub errors are reported, not shown as an empty file", async () => {
    const gh = fakeGitHub({
      [`${RAW} ${API}/contents/packages/viewer/src/ReviewViewer.tsx?ref=${HEAD}`]: () =>
        Response.json({ message: "API rate limit exceeded" }, { status: 403 }),
    });
    await expect(
      (await open(gh)).fileContent("packages/viewer/src/ReviewViewer.tsx", "head"),
    ).rejects.toThrow("GitHub answered 403 (API rate limit exceeded)");
  });
});

describe("never a partial diff", () => {
  test("GitHub's 'too large' answer gives a clear error", async () => {
    const gh = fakeGitHub({
      [`${DIFF} ${API}/pulls/28`]: () =>
        new Response(fixture("pr-diff-too-large-406.json"), { status: 406 }),
    });
    const source = await open(gh);
    const error = await source.diff().catch((e) => e);
    expect(error).toBeInstanceOf(PrTooLargeError);
    expect(String(error)).toContain("too large for GitHub's diff API");
    expect(String(error)).toContain("maximum number of files (300)");
    // File reads need the diff (their allowlist), so they fail the same way.
    await expect(
      source.fileContent("packages/viewer/src/ReviewViewer.tsx", "head"),
    ).rejects.toBeInstanceOf(PrTooLargeError);
  });

  test("a diff that does not match the PR's counts is refused", async () => {
    const pull = JSON.parse(fixture("pr-28.json"));
    const cut = fixture("pr-28.diff")
      .split(/(?=^diff --git )/m)
      .slice(0, 3)
      .join("");
    for (const [route, label] of [
      [{ [`${DIFF} ${API}/pulls/28`]: () => new Response(cut) }, "missing file"],
      [
        {
          [`${JSON_ACCEPT} ${API}/pulls/28`]: () => Response.json({ ...pull, additions: 36 }),
        },
        "other line count",
      ],
    ] as const) {
      const error = await (await open(fakeGitHub(route))).diff().catch((e) => e);
      expect(error, label).toBeInstanceOf(IncompleteDiffError);
      expect(String(error)).toContain("a partial diff is never shown");
    }
  });

  test("a failed diff is fetched again next time", async () => {
    let first = true;
    const gh = fakeGitHub({
      [`${DIFF} ${API}/pulls/28`]: () => {
        if (first) {
          first = false;
          return new Response("oops", { status: 502 });
        }
        return new Response(fixture("pr-28.diff"));
      },
    });
    const source = await open(gh);
    await expect(source.diff()).rejects.toThrow("GitHub answered 502");
    expect(await source.diff()).toBe(fixture("pr-28.diff"));
  });
});

describe("opening errors", () => {
  test("a PR the token cannot see", async () => {
    const gh = fakeGitHub();
    await expect(open(gh, { ...REF, number: 999 })).rejects.toThrow(
      "not found, or the token cannot see zbenhajsalah-cc/review-buddy#999",
    );
  });

  test("GitHub cannot be reached", async () => {
    const fetch: FetchFn = async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    };
    await expect(openGitHubPr(REF, { fetch, token: async () => "t" })).rejects.toThrow(
      "Could not reach GitHub",
    );
  });

  test("a bad PR reference never reaches a URL", async () => {
    const gh = fakeGitHub();
    for (const ref of [
      { ...REF, owner: "../x" },
      { ...REF, repo: "a/b" },
      { ...REF, repo: ".." },
      { ...REF, number: 0 },
      { ...REF, number: 1.5 },
    ]) {
      await expect(open(gh, ref)).rejects.toThrow();
    }
    expect(gh.calls).toEqual([]);
    expect(parsePrRef(REF)).toEqual(REF);
  });
});

describe("paths in URLs", () => {
  test("each segment is URL-encoded", () => {
    expect(encodePath("docs/a b#c?d%.md")).toBe("docs/a%20b%23c%3Fd%25.md");
    expect(encodePath("src/ü/文件.ts")).toBe("src/%C3%BC/%E6%96%87%E4%BB%B6.ts");
  });

  test("no empty, '.' or '..' segments", () => {
    for (const bad of ["../x", "a/../b", "a//b", "/a", "a/./b", "a/"]) {
      expect(() => encodePath(bad)).toThrow("Unsafe path");
    }
  });

  test("a file with special characters is fetched with an encoded URL", async () => {
    const path = "docs/my file #1.md";
    const diff = [
      `diff --git a/${path} b/${path}`,
      "index 1111111..2222222 100644",
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const pull = {
      ...JSON.parse(fixture("pr-28.json")),
      changed_files: 1,
      additions: 1,
      deletions: 1,
    };
    const gh = fakeGitHub({
      [`${JSON_ACCEPT} ${API}/pulls/28`]: () => Response.json(pull),
      [`${DIFF} ${API}/pulls/28`]: () => new Response(diff),
      [`${RAW} ${API}/contents/docs/my%20file%20%231.md?ref=${HEAD}`]: () => new Response("new\n"),
    });
    expect(await (await open(gh)).fileContent(path, "head")).toBe("new\n");
  });

  test("binary files and missing sides are empty without asking GitHub", async () => {
    const diff = [
      "diff --git a/logo.png b/logo.png",
      "index 1111111..2222222 100644",
      "Binary files a/logo.png and b/logo.png differ",
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1 @@",
      "+x",
      "",
    ].join("\n");
    const pull = {
      ...JSON.parse(fixture("pr-28.json")),
      changed_files: 2,
      additions: 1,
      deletions: 0,
    };
    const gh = fakeGitHub({
      [`${JSON_ACCEPT} ${API}/pulls/28`]: () => Response.json(pull),
      [`${DIFF} ${API}/pulls/28`]: () => new Response(diff),
    });
    const source = await open(gh);
    expect(await source.fileContent("logo.png", "head")).toBe("");
    expect(await source.fileContent("new.ts", "base")).toBe("");
    expect(gh.calls.some((c) => c.key.includes("/contents/"))).toBe(false);
  });
});
