import { describe, expect, test } from "bun:test";
import recorded from "./fixtures/repo-review-buddy.json" with { type: "json" };
import {
  GitHubRepos,
  hasNextPage,
  MAX_RECENT,
  parseFullName,
  REPOS_PER_PAGE,
  toRepoSummary,
} from "./repos.ts";

const API = "https://api.github.com";

/** A repo in GitHub's JSON shape: the recorded one, renamed. */
function repoJson(fullName: string, extra: Record<string, unknown> = {}) {
  const [owner, name] = fullName.split("/");
  return {
    ...recorded,
    full_name: fullName,
    name,
    owner: { ...recorded.owner, login: owner },
    ...extra,
  };
}

/**
 * A fake GitHub: /user/repos pages, single repos, and the token it accepts.
 * Every request is logged as "url authorization".
 */
function fakeGitHub(pages: unknown[][], single: Record<string, unknown> = {}) {
  const state = {
    /** The token GitHub accepts. */
    accepts: "ghp_good",
    calls: [] as string[],
    /** Set: every request gets this answer. */
    answer: undefined as (() => Response) | undefined,
  };
  const fetch = async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    state.calls.push(`${url.replace(API, "")} ${auth}`);
    if (state.answer) return state.answer();
    if (auth !== `Bearer ${state.accepts}`) {
      return Response.json({ message: "Bad credentials" }, { status: 401 });
    }
    const list = /^\/user\/repos\?per_page=100&page=(\d+)&sort=pushed$/.exec(url.replace(API, ""));
    if (list) {
      const n = Number(list[1]);
      const headers: Record<string, string> = {};
      if (n < pages.length) {
        headers.link = `<${API}/user/repos?per_page=100&page=${n + 1}&sort=pushed>; rel="next", <${API}/user/repos?per_page=100&page=${pages.length}&sort=pushed>; rel="last"`;
      }
      return Response.json(pages[n - 1] ?? [], { headers });
    }
    const one = single[url.replace(`${API}/repos/`, "")];
    return one ? Response.json(one) : Response.json({ message: "Not Found" }, { status: 404 });
  };
  return { fetch, state };
}

function setup(pages: unknown[][], single: Record<string, unknown> = {}, recent: string[] = []) {
  const github = fakeGitHub(pages, single);
  const auth = {
    /** The token the app has. */
    current: "ghp_good",
    token: async () => {
      if (auth.signedOut) throw new Error("Not signed in to GitHub. Connect it in Settings.");
      return auth.current;
    },
    rejected: [] as string[],
    signedOut: false,
    tokenRejected: async (token: string) => {
      auth.rejected.push(token);
    },
  };
  const saved = { list: recent };
  const repos = new GitHubRepos({
    fetch: github.fetch,
    auth,
    recent: {
      get: async () => saved.list,
      update: async (change) => {
        saved.list = change(saved.list);
      },
    },
    now: () => Date.parse("2026-10-27T12:00:00Z"),
  });
  return { repos, github, auth, saved };
}

describe("toRepoSummary", () => {
  test("the recorded GitHub repo", () => {
    expect(toRepoSummary(recorded)).toEqual({
      fullName: "zbenhajsalah-cc/review-buddy",
      owner: "zbenhajsalah-cc",
      name: "review-buddy",
      private: false,
      archived: false,
      fork: true,
      description: null,
      pushedAt: recorded.pushed_at,
    });
  });

  test("missing names are dropped; other fields have defaults", () => {
    expect(toRepoSummary(null)).toBeNull();
    expect(toRepoSummary({ full_name: "a/b", name: "b" })).toBeNull();
    expect(toRepoSummary({ full_name: "a/b", name: "b", owner: { login: "a" } })).toEqual({
      fullName: "a/b",
      owner: "a",
      name: "b",
      private: false,
      archived: false,
      fork: false,
      description: null,
      pushedAt: null,
    });
  });
});

test("hasNextPage reads GitHub's Link header", () => {
  expect(hasNextPage(null)).toBe(false);
  expect(
    hasNextPage(`<${API}/user/repos?page=1>; rel="prev", <${API}/user/repos?page=1>; rel="first"`),
  ).toBe(false);
  expect(
    hasNextPage(`<${API}/user/repos?page=3>; rel="next", <${API}/user/repos?page=9>; rel="last"`),
  ).toBe(true);
});

test("parseFullName accepts only owner/name safe in a URL", () => {
  expect(parseFullName("octocat/hello-world")).toEqual({ owner: "octocat", repo: "hello-world" });
  for (const bad of ["octocat", "a/b/c", "../b", "a/..", "a/b c", "a/b?x", "/b", 42]) {
    expect(parseFullName(bad)).toBeNull();
  }
});

describe("list", () => {
  test("pages of the login's repos, newest push first, with the token", async () => {
    const { repos, github } = setup([
      [repoJson("octocat/one"), repoJson("octo-org/two", { private: true })],
      [repoJson("octocat/three")],
    ]);
    const one = await repos.list(1);
    expect(one).toMatchObject({ ok: true, page: 1, hasMore: true, recent: [] });
    if (!one.ok) throw new Error("expected a page");
    expect(one.repos.map((r) => [r.fullName, r.private])).toEqual([
      ["octocat/one", false],
      ["octo-org/two", true],
    ]);
    const two = await repos.list(2);
    expect(two).toMatchObject({ ok: true, page: 2, hasMore: false });
    expect(two.ok && two.repos.map((r) => r.fullName)).toEqual(["octocat/three"]);
    // Only page 1 carries the recent repos.
    expect(two.ok && "recent" in two).toBe(false);
    expect(github.state.calls).toEqual([
      `/user/repos?per_page=${REPOS_PER_PAGE}&page=1&sort=pushed Bearer ghp_good`,
      `/user/repos?per_page=${REPOS_PER_PAGE}&page=2&sort=pushed Bearer ghp_good`,
    ]);
  });

  test("a page number from IPC is checked", async () => {
    const { repos, github } = setup([[]]);
    for (const bad of [0, -1, 1.5, "1", 1001, Number.NaN]) {
      await expect(repos.list(bad)).rejects.toThrow("Not a page number");
    }
    expect(github.state.calls).toEqual([]);
  });

  test("signed out, token rejected, offline, rate limit, other errors", async () => {
    const { repos, github, auth } = setup([[repoJson("octocat/one")]]);

    auth.signedOut = true;
    expect(await repos.list(1)).toEqual({
      ok: false,
      reason: "signed-out",
      error: "Not signed in to GitHub. Connect it in Settings.",
    });
    auth.signedOut = false;

    auth.current = "ghp_expired";
    const rejected = await repos.list(1);
    expect(rejected).toMatchObject({ ok: false, reason: "token-rejected" });
    expect(!rejected.ok && rejected.error).toContain("expired or was revoked");
    // The 401 is reported with the token that got it, so auth can sign out.
    expect(auth.rejected).toEqual(["ghp_expired"]);
    auth.current = "ghp_good";

    const offline = setup([]);
    offline.repos = new GitHubRepos({
      fetch: async () => {
        throw new Error("getaddrinfo ENOTFOUND api.github.com");
      },
      auth: offline.auth,
      recent: { get: async () => [], update: async () => {} },
    });
    expect(await offline.repos.list(1)).toEqual({
      ok: false,
      reason: "failed",
      error: "Could not reach GitHub (getaddrinfo ENOTFOUND api.github.com).",
    });

    github.state.answer = () =>
      new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Date.parse("2026-10-27T12:10:30Z") / 1000),
        },
      });
    expect(await repos.list(1)).toEqual({
      ok: false,
      reason: "failed",
      error: "GitHub's API rate limit is used up. Try again in 11 minute(s).",
    });

    github.state.answer = () => Response.json({ message: "Server Error" }, { status: 502 });
    expect(await repos.list(1)).toEqual({
      ok: false,
      reason: "failed",
      error: "GitHub answered 502 for your repositories (Server Error).",
    });

    github.state.answer = () => Response.json({ not: "a list" });
    expect(await repos.list(1)).toEqual({
      ok: false,
      reason: "failed",
      error: "GitHub sent no repository list.",
    });
  });
});

describe("recently used", () => {
  test("page 1 starts with them, read again with the current login", async () => {
    const { repos, github } = setup(
      [[repoJson("octocat/one"), repoJson("octocat/two")]],
      { "octo-org/old": repoJson("octo-org/old", { archived: true }) },
      // "octocat/TWO" is on page 1 (any case); octo-org/old is fetched;
      // octo-org/gone is not visible any more; the bad name is never sent.
      ["octo-org/gone", "octocat/TWO", "../x", "octo-org/old"],
    );
    const page = await repos.list(1);
    if (!page.ok) throw new Error("expected a page");
    expect(page.recent!.map((r) => [r.fullName, r.archived])).toEqual([
      ["octocat/two", false],
      ["octo-org/old", true],
    ]);
    expect(github.state.calls.slice(1).sort()).toEqual([
      "/repos/octo-org/gone Bearer ghp_good",
      "/repos/octo-org/old Bearer ghp_good",
    ]);
    // Repos fetched once are known for this login: no second request.
    await repos.list(1);
    expect(github.state.calls.filter((c) => c.startsWith("/repos/octo-org/old"))).toHaveLength(1);
  });

  test("another login forgets what the last one could see", async () => {
    // octo-org/private is known from the first login's page 1 only.
    const { repos, github, auth } = setup([[repoJson("octo-org/private", { private: true })]], {}, [
      "octo-org/private",
    ]);
    const first = await repos.list(1);
    expect(first.ok && first.recent!.map((r) => r.fullName)).toEqual(["octo-org/private"]);
    github.state.calls = [];
    github.state.accepts = auth.current = "ghp_second";
    github.state.answer = () => Response.json([]); // the second login sees no repos
    const second = await repos.list(1);
    expect(second.ok && second.recent).toEqual([]);
    expect(github.state.calls).toEqual([
      "/user/repos?per_page=100&page=1&sort=pushed Bearer ghp_second",
      "/repos/octo-org/private Bearer ghp_second",
    ]);
  });

  test("markUsed() puts a repo first, once, in GitHub's spelling, at most MAX_RECENT", async () => {
    const { repos, saved } = setup([[repoJson("OctoCat/Hello-World")]]);
    await repos.list(1);
    await repos.markUsed("octocat/hello-world");
    expect(saved.list).toEqual(["OctoCat/Hello-World"]);
    for (let i = 0; i < MAX_RECENT + 2; i++) await repos.markUsed(`octocat/r${i}`);
    await repos.markUsed("OCTOCAT/r3");
    expect(saved.list).toHaveLength(MAX_RECENT);
    expect(saved.list[0]).toBe("OCTOCAT/r3");
    expect(saved.list.filter((n) => n.toLowerCase() === "octocat/r3")).toHaveLength(1);
    expect(saved.list).not.toContain("OctoCat/Hello-World");
  });

  test("markUsed() refuses what is not owner/name", async () => {
    const { repos, saved } = setup([[]]);
    for (const bad of ["nope", "a/b/c", "../etc", 7, null]) {
      await expect(repos.markUsed(bad)).rejects.toThrow("Not a repository");
    }
    expect(saved.list).toEqual([]);
  });
});
