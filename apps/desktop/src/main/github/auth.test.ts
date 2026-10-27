import { describe, expect, mock, test } from "bun:test";
import { type FetchFn, GitHubAuth, type GitHubAuthDeps, parseToken } from "./auth.ts";
import type { TokenStore } from "./token-store.ts";

/** A fake GitHub /user that knows some tokens; `offline` makes it unreachable. */
function fakeGitHub(users: Record<string, string>) {
  const state = { offline: false, calls: [] as string[] };
  const fetch: FetchFn = async (url, init) => {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    state.calls.push(`${url} ${auth}`);
    if (state.offline) throw new Error("getaddrinfo ENOTFOUND api.github.com");
    const login = users[auth.replace(/^Bearer /, "")];
    return login
      ? Response.json({ login, name: null })
      : Response.json({ message: "Bad credentials" }, { status: 401 });
  };
  return { fetch, state };
}

function fakeStore(saved: string | null = null, persist = true) {
  const store = {
    saved,
    canPersist: () => persist,
    save: mock(async (t: string) => {
      store.saved = t;
    }),
    load: async () => store.saved,
    clear: mock(async () => {
      store.saved = null;
    }),
  };
  return store;
}

function setup(
  options: {
    saved?: string | null;
    persist?: boolean;
    gh?: string | null;
    ghDisabled?: boolean;
    users?: Record<string, string>;
  } = {},
) {
  const github = fakeGitHub(options.users ?? { ghp_good: "octocat", gho_cli: "monalisa" });
  const store = fakeStore(options.saved ?? null, options.persist ?? true);
  const flags = { ghDisabled: options.ghDisabled ?? false };
  const deps: GitHubAuthDeps = {
    fetch: github.fetch,
    store: store as unknown as TokenStore,
    ghDisabled: {
      get: async () => flags.ghDisabled,
      set: async (v) => {
        flags.ghDisabled = v;
      },
    },
    ghToken: async () => options.gh ?? null,
    ghInstalled: () => options.gh !== undefined,
  };
  return { auth: new GitHubAuth(deps), github, store, flags };
}

describe("at start", () => {
  test("a saved token comes first", async () => {
    const { auth, github } = setup({ saved: "ghp_good", gh: "gho_cli" });
    expect(await auth.status()).toMatchObject({
      signedIn: true,
      login: "octocat",
      source: "token",
    });
    expect(github.state.calls).toEqual(["https://api.github.com/user Bearer ghp_good"]);
    expect(await auth.token()).toBe("ghp_good");
  });

  test("else the GitHub CLI's login", async () => {
    const { auth } = setup({ gh: "gho_cli" });
    expect(await auth.status()).toMatchObject({ signedIn: true, login: "monalisa", source: "gh" });
  });

  test("a logged-out gh is simply 'not signed in', with no error", async () => {
    const { auth } = setup({ gh: null });
    const status = await auth.status();
    expect(status).toEqual({ signedIn: false, tokenStorage: "encrypted", ghInstalled: true });
  });

  test("gh is not used after the user signed out of it here", async () => {
    const { auth, github } = setup({ gh: "gho_cli", ghDisabled: true });
    expect((await auth.status()).signedIn).toBe(false);
    expect(github.state.calls).toEqual([]);
  });

  test("a saved token GitHub rejects is deleted, said once, and gh is tried", async () => {
    const { auth, store } = setup({ saved: "ghp_revoked", gh: "gho_cli" });
    const first = await auth.status();
    expect(first).toMatchObject({ signedIn: true, source: "gh" });
    expect(first.error).toContain("saved token no longer works");
    expect(store.saved).toBeNull();
    expect((await auth.status()).error).toBeUndefined();
  });

  test("offline: not signed in, and the next status tries again", async () => {
    const { auth, github, store } = setup({ saved: "ghp_good" });
    github.state.offline = true;
    const first = await auth.status();
    expect(first.signedIn).toBe(false);
    expect(first.error).toContain("Could not reach GitHub");
    expect(store.saved).toBe("ghp_good"); // kept: it may still be fine
    github.state.offline = false;
    expect(await auth.status()).toMatchObject({ signedIn: true, login: "octocat" });
  });
});

describe("signInWithToken", () => {
  test("checks the token, then saves it encrypted", async () => {
    const { auth, store } = setup();
    const status = await auth.signInWithToken("  ghp_good \n");
    expect(status).toMatchObject({ signedIn: true, login: "octocat", source: "token" });
    expect(store.save).toHaveBeenCalledWith("ghp_good");
  });

  test("without OS encryption it is kept for this run only", async () => {
    const { auth, store } = setup({ persist: false });
    const status = await auth.signInWithToken("ghp_good");
    expect(status).toMatchObject({ signedIn: true, tokenStorage: "memory" });
    expect(store.save).not.toHaveBeenCalled();
    expect(await auth.token()).toBe("ghp_good");
  });

  test("a token GitHub rejects is not saved", async () => {
    const { auth, store } = setup();
    const status = await auth.signInWithToken("ghp_bad");
    expect(status.signedIn).toBe(false);
    expect(status.error).toContain("GitHub rejected this token");
    expect(store.save).not.toHaveBeenCalled();
  });

  test("not a token at all: refused without asking GitHub", async () => {
    const { auth, github } = setup();
    for (const bad of ["", "two words", 42, null, "x".repeat(256)]) {
      expect((await auth.signInWithToken(bad)).error).toBe(
        "That does not look like a GitHub token.",
      );
    }
    expect(github.state.calls).toEqual([]);
  });
});

describe("sign out and gh", () => {
  test("signing out of a pasted token deletes it", async () => {
    const { auth, store, flags } = setup({ saved: "ghp_good" });
    await auth.status();
    expect((await auth.signOut()).signedIn).toBe(false);
    expect(store.saved).toBeNull();
    expect(flags.ghDisabled).toBe(false);
    await expect(auth.token()).rejects.toThrow("Not signed in");
  });

  test("signing out of gh stops using it, and 'use gh' turns it back on", async () => {
    const { auth, flags } = setup({ gh: "gho_cli" });
    await auth.status();
    await auth.signOut();
    expect(flags.ghDisabled).toBe(true);
    expect(await auth.useGh()).toMatchObject({ signedIn: true, source: "gh" });
    expect(flags.ghDisabled).toBe(false);
  });

  test("'use gh' with a logged-out gh says what to do", async () => {
    const { auth } = setup({ gh: null });
    expect((await auth.useGh()).error).toContain("gh auth login");
  });
});

describe("tokenRejected (a 401 on a later call)", () => {
  test("a pasted token: signed out, token deleted, reason said once", async () => {
    const { auth, store } = setup({ saved: "ghp_good" });
    await auth.status();
    await auth.tokenRejected("ghp_good");
    expect(store.saved).toBeNull();
    const status = await auth.status();
    expect(status).toMatchObject({ signedIn: false });
    expect(status.error).toBe(
      "GitHub rejected the token: it expired or was revoked. Sign in again.",
    );
    expect((await auth.status()).error).toBeUndefined();
    await expect(auth.token()).rejects.toThrow("Not signed in");
  });

  test("gh: signed out, gh left as it is, and 'use gh' works again", async () => {
    const { auth, flags } = setup({ gh: "gho_cli" });
    await auth.status();
    await auth.tokenRejected("gho_cli");
    expect((await auth.status()).error).toContain("Run `gh auth login` again");
    expect(flags.ghDisabled).toBe(false);
    expect(await auth.useGh()).toMatchObject({ signedIn: true, source: "gh" });
  });

  test("an old token's 401 does not sign out a newer login", async () => {
    const { auth, store } = setup({ saved: "ghp_good", users: { ghp_good: "a", ghp_new: "b" } });
    await auth.status();
    await auth.signInWithToken("ghp_new");
    await auth.tokenRejected("ghp_good");
    expect(await auth.status()).toMatchObject({ signedIn: true, login: "b" });
    expect(store.saved).toBe("ghp_new");
  });
});

test("no status ever contains the token", async () => {
  const { auth } = setup({ saved: "ghp_good", gh: "gho_cli" });
  const all = [
    await auth.status(),
    await auth.signInWithToken("ghp_good"),
    await auth.signOut(),
    await auth.useGh(),
  ];
  const text = JSON.stringify(all);
  expect(text).not.toContain("ghp_good");
  expect(text).not.toContain("gho_cli");
});

test("parseToken keeps one printable word", () => {
  expect(parseToken(" github_pat_11AB_cd \n")).toBe("github_pat_11AB_cd");
  expect(parseToken("a b")).toBeNull();
  expect(parseToken("tök")).toBeNull();
});
