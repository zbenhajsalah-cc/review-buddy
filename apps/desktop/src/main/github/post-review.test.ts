import { describe, expect, test } from "bun:test";
import type { PostedReview } from "../../shared/ipc.ts";
import {
  githubError,
  MAX_REVIEW_BODY,
  parsePostRequest,
  postPrReview,
  ReviewPosting,
} from "./post-review.ts";

const HEAD = "c".repeat(40);
const NEWER = "e".repeat(40);
const PULL = "https://api.github.com/repos/octo/repo/pulls/12";
const NOW = () => new Date("2026-10-28T09:00:00Z");
const REF = { owner: "octo", repo: "repo", number: 12 };

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body?: unknown;
}

/** A fake GitHub: `answers` by "METHOD url"; it records every call. */
function fakeGitHub(answers: Record<string, () => Response>) {
  const calls: Call[] = [];
  const rejected: string[] = [];
  const deps = {
    fetch: async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        auth: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const answer = answers[`${method} ${url}`];
      return answer ? answer() : Response.json({ message: "Not Found" }, { status: 404 });
    },
    auth: {
      token: async () => "ghp_test",
      tokenRejected: async (token: string) => {
        rejected.push(token);
      },
    },
    now: NOW,
  };
  return { deps, calls, rejected };
}

const pullAt = (sha: string) => () => Response.json({ number: 12, head: { sha } });
const created = () =>
  Response.json({
    id: 7,
    html_url: "https://github.com/octo/repo/pull/12#pullrequestreview-7",
    user: { login: "octocat" },
    state: "APPROVED",
  });

describe("parsePostRequest", () => {
  test("keeps a verdict and a text", () => {
    expect(parsePostRequest({ verdict: "approve", body: "", extra: 1 })).toEqual({
      verdict: "approve",
      body: "",
    });
    expect(parsePostRequest({ verdict: "comment", body: "Nice." })).toEqual({
      verdict: "comment",
      body: "Nice.",
    });
  });

  test("refuses bad values; only Approve may have no text", () => {
    for (const bad of [
      null,
      "approve",
      { verdict: "APPROVE", body: "" },
      { verdict: "approve" },
      { verdict: "approve", body: "x".repeat(MAX_REVIEW_BODY + 1) },
    ]) {
      expect(() => parsePostRequest(bad)).toThrow();
    }
    expect(() => parsePostRequest({ verdict: "request_changes", body: "  " })).toThrow(
      "needs a text",
    );
    expect(() => parsePostRequest({ verdict: "comment", body: "" })).toThrow("needs a text");
  });
});

test("githubError reads message and errors", () => {
  expect(
    githubError(
      JSON.stringify({
        message: "Unprocessable Entity",
        errors: ["Can not approve your own pull request"],
      }),
    ),
  ).toBe("Unprocessable Entity: Can not approve your own pull request");
  expect(
    githubError(JSON.stringify({ message: "x", errors: [{ message: "y" }, { code: 1 }] })),
  ).toBe("x: y");
  expect(githubError("not json")).toBe("");
});

describe("postPrReview", () => {
  test("posts the verdict and text on the reviewed commit", async () => {
    const { deps, calls } = fakeGitHub({
      [`GET ${PULL}`]: pullAt(HEAD),
      [`POST ${PULL}/reviews`]: created,
    });
    const result = await postPrReview(deps, REF, HEAD, {
      verdict: "request_changes",
      body: "Please add a test.",
    });
    expect(result).toEqual({
      ok: true,
      posted: {
        verdict: "request_changes",
        postedAt: "2026-10-28T09:00:00.000Z",
        url: "https://github.com/octo/repo/pull/12#pullrequestreview-7",
        login: "octocat",
      },
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${PULL}`,
      `POST ${PULL}/reviews`,
    ]);
    expect(calls[1]!.auth).toBe("Bearer ghp_test");
    expect(calls[1]!.body).toEqual({
      commit_id: HEAD,
      event: "REQUEST_CHANGES",
      body: "Please add a test.",
    });
  });

  test("an approval with no text sends no body; each verdict has its event", async () => {
    for (const [verdict, event] of [
      ["approve", "APPROVE"],
      ["comment", "COMMENT"],
    ] as const) {
      const { deps, calls } = fakeGitHub({
        [`GET ${PULL}`]: pullAt(HEAD),
        [`POST ${PULL}/reviews`]: created,
      });
      const body = verdict === "approve" ? "" : "FYI";
      expect((await postPrReview(deps, REF, HEAD, { verdict, body })).ok).toBe(true);
      expect(calls[1]!.body).toEqual(
        body ? { commit_id: HEAD, event, body } : { commit_id: HEAD, event },
      );
    }
  });

  test("new commits since the review: nothing is posted", async () => {
    const { deps, calls } = fakeGitHub({ [`GET ${PULL}`]: pullAt(NEWER) });
    const result = await postPrReview(deps, REF, HEAD, { verdict: "approve", body: "" });
    expect(result).toEqual({
      ok: false,
      reason: "outdated",
      error:
        "octo/repo#12 has new commits since this review (ccccccc → eeeeeee). Review it again before you post. Nothing was posted.",
    });
    expect(calls).toHaveLength(1);
  });

  test("signed out, and a token GitHub rejects (main signs out)", async () => {
    const out = fakeGitHub({});
    out.deps.auth.token = async () => {
      throw new Error("Not signed in to GitHub.");
    };
    expect(await postPrReview(out.deps, REF, HEAD, { verdict: "approve", body: "" })).toEqual({
      ok: false,
      reason: "signed-out",
      error: "Not signed in to GitHub.",
    });
    expect(out.calls).toHaveLength(0);

    const bad = fakeGitHub({
      [`GET ${PULL}`]: () => Response.json({ message: "Bad credentials" }, { status: 401 }),
    });
    const result = await postPrReview(bad.deps, REF, HEAD, { verdict: "approve", body: "" });
    expect(result).toMatchObject({ ok: false, reason: "token-rejected" });
    expect(bad.rejected).toEqual(["ghp_test"]);
  });

  test("GitHub refuses: its reason, and what the token needs", async () => {
    const own = fakeGitHub({
      [`GET ${PULL}`]: pullAt(HEAD),
      [`POST ${PULL}/reviews`]: () =>
        Response.json(
          { message: "Unprocessable Entity", errors: ["Can not approve your own pull request"] },
          { status: 422 },
        ),
    });
    expect(await postPrReview(own.deps, REF, HEAD, { verdict: "approve", body: "" })).toEqual({
      ok: false,
      reason: "failed",
      error:
        "GitHub answered 422 (Unprocessable Entity: Can not approve your own pull request). Nothing was posted.",
    });

    const readOnly = fakeGitHub({
      [`GET ${PULL}`]: pullAt(HEAD),
      [`POST ${PULL}/reviews`]: () =>
        Response.json(
          { message: "Resource not accessible by personal access token" },
          { status: 403 },
        ),
    });
    const result = await postPrReview(readOnly.deps, REF, HEAD, { verdict: "approve", body: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Resource not accessible by personal access token");
      expect(result.error).toContain('"Pull requests: Read and write"');
      expect(result.error).toContain("repo scope");
    }

    const limited = fakeGitHub({
      [`GET ${PULL}`]: pullAt(HEAD),
      [`POST ${PULL}/reviews`]: () =>
        Response.json(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(NOW().getTime() / 1000 + 600),
            },
          },
        ),
    });
    const late = await postPrReview(limited.deps, REF, HEAD, { verdict: "approve", body: "" });
    expect(late).toMatchObject({ ok: false, reason: "failed" });
    if (!late.ok) expect(late.error).toContain("rate limit is used up. Try again in 10 minute(s).");
  });

  test("a connection that breaks during the POST may have posted: it says so", async () => {
    const { deps } = fakeGitHub({ [`GET ${PULL}`]: pullAt(HEAD) });
    const fetch = deps.fetch;
    deps.fetch = async (url, init) => {
      if (init?.method === "POST") throw new Error("socket hang up");
      return fetch(url, init);
    };
    const result = await postPrReview(deps, REF, HEAD, { verdict: "approve", body: "" });
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    if (!result.ok) {
      expect(result.error).toContain("socket hang up");
      expect(result.error).toContain("may have been posted");
    }
  });

  test("a review URL that is not on github.com is replaced by the PR's", async () => {
    const { deps } = fakeGitHub({
      [`GET ${PULL}`]: pullAt(HEAD),
      [`POST ${PULL}/reviews`]: () =>
        Response.json({ html_url: "javascript:alert(1)", user: { login: "octocat" } }),
    });
    const result = await postPrReview(deps, REF, HEAD, { verdict: "approve", body: "" });
    expect(result.ok && result.posted.url).toBe("https://github.com/octo/repo/pull/12");
  });
});

describe("ReviewPosting", () => {
  const setup = (answers: Record<string, () => Response>) => {
    const github = fakeGitHub(answers);
    const marked: [string, PostedReview][] = [];
    const posting = new ReviewPosting({
      ...github.deps,
      store: {
        prOf: (key) =>
          key === "octo/repo#12@cccccccccccc"
            ? { label: "octo/repo#12", headSha: HEAD }
            : undefined,
        markPosted: async (key, posted) => {
          marked.push([key, posted]);
        },
      },
    });
    return { posting, marked, calls: github.calls };
  };

  test("posts a review the app has and keeps the record; refuses others", async () => {
    const { posting, marked } = setup({
      [`GET ${PULL}`]: pullAt(HEAD),
      [`POST ${PULL}/reviews`]: created,
    });
    const result = await posting.post("octo/repo#12@cccccccccccc", {
      verdict: "approve",
      body: "LGTM",
    });
    expect(result.ok).toBe(true);
    expect(marked.map(([key, p]) => `${key} ${p.verdict}`)).toEqual([
      "octo/repo#12@cccccccccccc approve",
    ]);
    await expect(posting.post("fixture", { verdict: "approve", body: "" })).rejects.toThrow(
      "unknown review",
    );
    await expect(posting.post("octo/repo#12@cccccccccccc", { verdict: "nope" })).rejects.toThrow(
      "invalid verdict",
    );
  });

  test("a failed post keeps no record", async () => {
    const { posting, marked } = setup({ [`GET ${PULL}`]: pullAt(NEWER) });
    const result = await posting.post("octo/repo#12@cccccccccccc", {
      verdict: "approve",
      body: "",
    });
    expect(result).toMatchObject({ ok: false, reason: "outdated" });
    expect(marked).toEqual([]);
  });

  test("a second post of the same review while the first runs is refused", async () => {
    const { posting, calls } = setup({
      [`GET ${PULL}`]: pullAt(HEAD),
      [`POST ${PULL}/reviews`]: created,
    });
    const slow = posting.post("octo/repo#12@cccccccccccc", { verdict: "approve", body: "" });
    // (The first post has not finished: it waits for its token.)
    await expect(
      posting.post("octo/repo#12@cccccccccccc", { verdict: "approve", body: "" }),
    ).rejects.toThrow("being posted already");
    expect((await slow).ok).toBe(true);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
});
