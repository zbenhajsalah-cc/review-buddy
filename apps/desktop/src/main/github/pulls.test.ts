import { describe, expect, test } from "bun:test";
import pr28 from "./fixtures/pr-28.json" with { type: "json" };
import { GitHubPulls, PULLS_PER_PAGE, toPullSummary, toSize } from "./pulls.ts";

const API = "https://api.github.com";
const REPO = "/repos/zbenhajsalah-cc/review-buddy";
const SHA = (n: number) => String(n).padStart(40, "a");

/**
 * A PR as the list endpoint sends it: the recorded PR's shape without the
 * fields only the single-PR endpoint has (sizes, mergeability).
 */
function listItem(number: number, extra: Record<string, unknown> = {}) {
  const { additions: _a, deletions: _d, changed_files: _c, commits: _m, ...item } = pr28;
  return { ...item, number, head: { ...pr28.head, sha: SHA(number) }, ...extra };
}

/** A fake GitHub: one list page per entry of `pages`, and single PRs with sizes. */
function setup(pages: unknown[][], options: { sizeFails?: number[]; sizeHangs?: number[] } = {}) {
  const calls: string[] = [];
  const state = { answer: undefined as (() => Response) | undefined };
  const fetch = async (url: string, init?: RequestInit) => {
    const path = url.replace(API, "");
    calls.push(path);
    if (state.answer) return state.answer();
    const list = new RegExp(
      `^${REPO}/pulls\\?state=open&sort=updated&direction=desc&per_page=${PULLS_PER_PAGE}&page=(\\d+)$`,
    ).exec(path);
    if (list) {
      const n = Number(list[1]);
      return Response.json(pages[n - 1] ?? [], {
        headers:
          n < pages.length ? { link: `<${API}${REPO}/pulls?page=${n + 1}>; rel="next"` } : {},
      });
    }
    const one = new RegExp(`^${REPO}/pulls/(\\d+)$`).exec(path);
    if (one) {
      const n = Number(one[1]);
      if (options.sizeFails?.includes(n))
        return Response.json({ message: "boom" }, { status: 502 });
      if (options.sizeHangs?.includes(n)) {
        // Like a request that never answers: only its signal ends it.
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
        );
      }
      return Response.json({ ...pr28, number: n, additions: n, deletions: 1, changed_files: 2 });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  };
  const rejected: string[] = [];
  const reviews = new Map<string, { reviewKey: string; headSha: string }>();
  const pulls = new GitHubPulls({
    fetch,
    auth: {
      token: async () => "ghp_good",
      tokenRejected: async (token) => {
        rejected.push(token);
      },
    },
    reviewOf: (label) => reviews.get(label),
    sizeTimeoutMs: 50,
  });
  return { pulls, calls, state, rejected, reviews };
}

describe("toPullSummary and toSize", () => {
  test("the recorded PR", () => {
    expect(toPullSummary(pr28)).toEqual({
      number: 28,
      title: "fix(viewer): start fresh when ReviewViewer gets another review",
      author: "zbenhajsalah-cc",
      updatedAt: "2026-10-27T10:40:00Z",
      draft: false,
      url: "https://github.com/zbenhajsalah-cc/review-buddy/pull/28",
      headSha: "7e8e70534d5fdb0a8ef1a5a0bf8407774b007b00",
    });
    expect(toSize(pr28)).toEqual({ additions: 35, deletions: 5, changedFiles: 4 });
  });

  test("a PR without a number, title or head SHA is dropped", () => {
    expect(toPullSummary(null)).toBeNull();
    expect(toPullSummary({ ...pr28, number: "28" })).toBeNull();
    expect(toPullSummary({ ...pr28, title: undefined })).toBeNull();
    expect(toPullSummary({ ...pr28, head: { sha: "main" } })).toBeNull();
    expect(toPullSummary({ ...pr28, user: null, draft: true })).toMatchObject({
      author: "unknown",
      draft: true,
    });
    expect(toSize({ additions: 1, deletions: -1, changed_files: 1 })).toBeNull();
    expect(toSize(listItem(1))).toBeNull();
  });
});

describe("list", () => {
  test("open PRs, newest update first, each with its size and the app's review", async () => {
    const { pulls, calls, reviews } = setup([
      [listItem(7, { draft: true }), listItem(3)],
      [listItem(1)],
    ]);
    reviews.set("zbenhajsalah-cc/review-buddy#3", { reviewKey: "k3", headSha: SHA(2) });
    const one = await pulls.list("zbenhajsalah-cc/review-buddy", 1);
    expect(one).toEqual({
      ok: true,
      repo: "zbenhajsalah-cc/review-buddy",
      page: 1,
      hasMore: true,
      pulls: [
        {
          ...toPullSummary(listItem(7))!,
          draft: true,
          size: { additions: 7, deletions: 1, changedFiles: 2 },
        },
        {
          ...toPullSummary(listItem(3))!,
          size: { additions: 3, deletions: 1, changedFiles: 2 },
          review: { reviewKey: "k3", headSha: SHA(2) },
        },
      ],
    });
    expect(calls.sort()).toEqual([
      `${REPO}/pulls/3`,
      `${REPO}/pulls/7`,
      `${REPO}/pulls?state=open&sort=updated&direction=desc&per_page=30&page=1`,
    ]);
    const two = await pulls.list("zbenhajsalah-cc/review-buddy", 2);
    expect(two).toMatchObject({ ok: true, page: 2, hasMore: false });
  });

  test("sizes are kept per PR head; one that cannot be read is left out", async () => {
    const { pulls, calls } = setup([[listItem(7), listItem(3)]], { sizeFails: [3] });
    const first = await pulls.list("zbenhajsalah-cc/review-buddy", 1);
    expect(first.ok && first.pulls.map((p) => p.size?.additions)).toEqual([7, undefined]);
    calls.length = 0;
    await pulls.list("zbenhajsalah-cc/review-buddy", 1);
    // #7 is known at that head; #3 is tried again.
    expect(calls.filter((c) => /pulls\/\d+$/.test(c))).toEqual([`${REPO}/pulls/3`]);
  });

  test("a size read that hangs is given up, and the list still comes", async () => {
    const { pulls } = setup([[listItem(7), listItem(3)]], { sizeHangs: [7] });
    const page = await pulls.list("zbenhajsalah-cc/review-buddy", 1);
    expect(page.ok && page.pulls.map((p) => p.size?.additions)).toEqual([undefined, 3]);
  });

  test("bad arguments from IPC are refused before any request", async () => {
    const { pulls, calls } = setup([[]]);
    for (const bad of ["nope", "a/b/c", "../x", 42]) {
      await expect(pulls.list(bad, 1)).rejects.toThrow("Not a repository");
    }
    await expect(pulls.list("a/b", 0)).rejects.toThrow("Not a page number");
    expect(calls).toEqual([]);
  });

  test("not found, token rejected, other failures", async () => {
    const { pulls, state, rejected } = setup([[]]);
    expect(await pulls.list("octocat/missing", 1)).toEqual({
      ok: false,
      reason: "failed",
      error: "octocat/missing: not found, or the token cannot see it.",
    });
    state.answer = () => Response.json({ message: "Bad credentials" }, { status: 401 });
    expect(await pulls.list("zbenhajsalah-cc/review-buddy", 1)).toMatchObject({
      ok: false,
      reason: "token-rejected",
    });
    expect(rejected).toEqual(["ghp_good"]);
    state.answer = () => Response.json({ message: "Server Error" }, { status: 500 });
    expect(await pulls.list("zbenhajsalah-cc/review-buddy", 1)).toEqual({
      ok: false,
      reason: "failed",
      error:
        "GitHub answered 500 for the pull requests of zbenhajsalah-cc/review-buddy (Server Error).",
    });
  });
});
