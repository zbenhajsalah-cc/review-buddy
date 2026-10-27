/**
 * The GitHub login of the desktop app (US-10). Main is the only place that
 * holds the token; the renderer sees a `GitHubStatus` (login, source) and
 * never the token.
 *
 * Where the token comes from, in order:
 *  1. a token the user pasted (kept with safeStorage, see token-store.ts);
 *  2. the GitHub CLI (`gh auth token`), unless the user signed out of it here.
 * Every token is checked with GET /user before use.
 *
 * Dependencies are passed in (no Electron import), so this is tested with bun.
 */
import type { GitHubStatus } from "../../shared/ipc.ts";
import type { TokenStore } from "./token-store.ts";

export const GITHUB_API = "https://api.github.com";

export interface GitHubUser {
  login: string;
  name: string | null;
}

/** `fetch`, narrowed to what is used (main passes Electron's net.fetch). */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface GitHubAuthDeps {
  fetch: FetchFn;
  store: TokenStore;
  /** Signing out of the gh login here sets this, so it is not picked up again. */
  ghDisabled: { get(): Promise<boolean>; set(value: boolean): Promise<void> };
  ghToken: () => Promise<string | null>;
  ghInstalled: () => boolean;
}

/** GitHub said no (401): the token is wrong, expired or revoked. */
export class TokenRejectedError extends Error {}

/** Headers for every GitHub REST call made with this token. */
export function githubHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "review-buddy-desktop",
  };
}

export async function fetchUser(fetchFn: FetchFn, token: string): Promise<GitHubUser> {
  let res: Response;
  try {
    res = await fetchFn(`${GITHUB_API}/user`, { headers: githubHeaders(token) });
  } catch (e) {
    throw new Error(`Could not reach GitHub (${e instanceof Error ? e.message : String(e)}).`);
  }
  if (res.status === 401) throw new TokenRejectedError("GitHub rejected the token (401).");
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for /user.`);
  const body = (await res.json()) as { login?: unknown; name?: unknown };
  if (typeof body.login !== "string") throw new Error("GitHub sent no login for /user.");
  return { login: body.login, name: typeof body.name === "string" ? body.name : null };
}

/** A pasted token: one line of printable characters, at most 255 (GitHub's limit). */
export function parseToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return token.length > 0 && token.length <= 255 && /^[\x21-\x7e]+$/.test(token) ? token : null;
}

interface Session {
  token: string;
  source: "gh" | "token";
  user: GitHubUser;
}

export class GitHubAuth {
  #session: Session | null = null;
  #error: string | undefined;
  #loaded = false;
  /** One step at a time: a sign-out must not race a sign-in. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: GitHubAuthDeps) {}

  status(): Promise<GitHubStatus> {
    return this.#run(async () => {
      if (!this.#loaded) await this.#load();
      return this.#status();
    });
  }

  /** The token for GitHub API calls in main (US-11). Throws when signed out. */
  token(): Promise<string> {
    return this.#run(async () => {
      if (!this.#loaded) await this.#load();
      if (!this.#session) throw new Error("Not signed in to GitHub.");
      return this.#session.token;
    });
  }

  signInWithToken(value: unknown): Promise<GitHubStatus> {
    return this.#run(async () => {
      this.#loaded = true;
      const token = parseToken(value);
      if (!token) return this.#status("That does not look like a GitHub token.");
      try {
        const user = await fetchUser(this.deps.fetch, token);
        if (this.deps.store.canPersist()) await this.deps.store.save(token);
        this.#session = { token, source: "token", user };
        return this.#status();
      } catch (e) {
        return this.#status(
          e instanceof TokenRejectedError
            ? "GitHub rejected this token. Check that it is complete and not expired."
            : String(e instanceof Error ? e.message : e),
        );
      }
    });
  }

  useGh(): Promise<GitHubStatus> {
    return this.#run(async () => {
      this.#loaded = true;
      await this.deps.ghDisabled.set(false);
      const error = await this.#tryGh();
      // A saved token would win again at the next start.
      if (!error) await this.deps.store.clear();
      return this.#status(error);
    });
  }

  signOut(): Promise<GitHubStatus> {
    return this.#run(async () => {
      this.#loaded = true;
      // A pasted token is forgotten. gh stays logged in (it is not ours to
      // log out); the app just stops using it until "Use GitHub CLI".
      await this.deps.store.clear();
      if (this.#session?.source === "gh") await this.deps.ghDisabled.set(true);
      this.#session = null;
      return this.#status();
    });
  }

  /** First use: the saved token, else gh. A network failure is retried next time. */
  async #load(): Promise<void> {
    this.#loaded = true;
    const saved = await this.deps.store.load();
    if (saved) {
      try {
        const user = await fetchUser(this.deps.fetch, saved);
        this.#session = { token: saved, source: "token", user };
        return;
      } catch (e) {
        if (!(e instanceof TokenRejectedError)) {
          this.#loaded = false;
          this.#error = String(e instanceof Error ? e.message : e);
          return;
        }
        await this.deps.store.clear();
        this.#error = "The saved token no longer works (GitHub rejected it). Paste a new one.";
        // Then try gh, like a first start.
      }
    }
    if (!(await this.deps.ghDisabled.get())) {
      const error = await this.#tryGh();
      // A logged-out or missing gh is the normal "not signed in" state.
      if (error && error !== GH_NOT_LOGGED_IN) this.#error = error;
    }
  }

  async #tryGh(): Promise<string | undefined> {
    const token = await this.deps.ghToken();
    if (!token) return GH_NOT_LOGGED_IN;
    try {
      this.#session = { token, source: "gh", user: await fetchUser(this.deps.fetch, token) };
      return undefined;
    } catch (e) {
      if (e instanceof TokenRejectedError) {
        return "GitHub rejected the GitHub CLI's token. Run `gh auth login` again.";
      }
      if (e instanceof Error && e.message.startsWith("Could not reach")) this.#loaded = false;
      return String(e instanceof Error ? e.message : e);
    }
  }

  #status(error?: string): GitHubStatus {
    const s = this.#session;
    const status: GitHubStatus = {
      signedIn: !!s,
      tokenStorage: this.deps.store.canPersist() ? "encrypted" : "memory",
      ghInstalled: this.deps.ghInstalled(),
    };
    if (s) Object.assign(status, { login: s.user.login, name: s.user.name, source: s.source });
    const shown = error ?? this.#error;
    this.#error = undefined; // shown once
    if (shown) status.error = shown;
    return status;
  }

  #run<T>(step: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(step, step);
    this.#queue = next.catch(() => {});
    return next;
  }
}

const GH_NOT_LOGGED_IN =
  "The GitHub CLI is not installed or not logged in. Run `gh auth login`, then try again.";
