/**
 * The repositories of the GitHub login (US-13), for the repository list:
 *
 *   GET /user/repos?per_page=100&page={n}&sort=pushed    one page, newest push first
 *   GET /repos/{owner}/{repo}                             a recent repo not on page 1
 *
 * Also keeps the "recently used" list (in the app settings): a repo is used
 * when the user picks it or a review of one of its PRs starts. Page 1 comes
 * with those repos first, resolved again with the current login (a repo it
 * cannot see is left out).
 *
 * Failures are answers (`GitHubListError`, see list-call.ts): a 401 signs the
 * app out of GitHub (the token expired or was revoked).
 *
 * Dependencies are passed in (no Electron import), so this is tested with bun.
 */
import type { GitHubListError, RepoPage, RepoSummary } from "../../shared/ipc.ts";
import { isRepoName } from "./api-source.ts";
import { GITHUB_API, githubHeaders } from "./auth.ts";
import { checkPage, getListPage, type ListCallDeps } from "./list-call.ts";

export const REPOS_PER_PAGE = 100;
/** How many recently used repos are kept. */
export const MAX_RECENT = 8;

export interface GitHubReposDeps extends ListCallDeps {
  /** The recently used list, most recent first (`update` reads and writes in one step). */
  recent: {
    get(): Promise<string[]>;
    update(change: (list: string[]) => string[]): Promise<void>;
  };
}

/** A repo of GitHub's JSON, or null if a field the list needs is missing. */
export function toRepoSummary(json: unknown): RepoSummary | null {
  const r = json as {
    full_name?: unknown;
    name?: unknown;
    owner?: { login?: unknown } | null;
    private?: unknown;
    archived?: unknown;
    fork?: unknown;
    description?: unknown;
    pushed_at?: unknown;
  } | null;
  if (
    !r ||
    typeof r.full_name !== "string" ||
    typeof r.name !== "string" ||
    typeof r.owner?.login !== "string"
  ) {
    return null;
  }
  return {
    fullName: r.full_name,
    owner: r.owner.login,
    name: r.name,
    private: r.private === true,
    archived: r.archived === true,
    fork: r.fork === true,
    description: typeof r.description === "string" ? r.description : null,
    pushedAt: typeof r.pushed_at === "string" ? r.pushed_at : null,
  };
}

/** `owner/name` with both parts safe in a URL path, or null. */
export function parseFullName(value: unknown): { owner: string; repo: string } | null {
  if (typeof value !== "string") return null;
  const [owner, repo, ...rest] = value.split("/");
  if (rest.length || !owner || !repo || !isRepoName(owner) || !isRepoName(repo)) return null;
  return { owner, repo };
}

export class GitHubRepos {
  /** Repos seen with `#knownToken`, by lower-case full name. */
  #known = new Map<string, RepoSummary>();
  #knownToken = "";

  constructor(private readonly deps: GitHubReposDeps) {}

  async list(page: unknown): Promise<RepoPage | GitHubListError> {
    const n = checkPage(page);
    const url = `${GITHUB_API}/user/repos?per_page=${REPOS_PER_PAGE}&page=${n}&sort=pushed`;
    const answer = await getListPage(this.deps, url, "your repositories");
    if (!answer.ok) return answer;
    if (answer.token !== this.#knownToken) {
      this.#known.clear();
      this.#knownToken = answer.token;
    }
    const repos = answer.items.map(toRepoSummary).filter((r): r is RepoSummary => r !== null);
    for (const repo of repos) this.#known.set(repo.fullName.toLowerCase(), repo);
    const result: RepoPage = { ok: true, page: n, repos, hasMore: answer.hasMore };
    if (n === 1) result.recent = await this.#recent(answer.token);
    return result;
  }

  /** The user picked this repo, or a review of one of its PRs started. */
  async markUsed(fullName: unknown): Promise<void> {
    const name = parseFullName(fullName);
    if (!name) throw new Error(`Not a repository: ${String(fullName)}`);
    const typed = `${name.owner}/${name.repo}`;
    const spelled = this.#known.get(typed.toLowerCase())?.fullName ?? typed;
    await this.deps.recent.update((list) =>
      [spelled, ...list.filter((n) => n.toLowerCase() !== spelled.toLowerCase())].slice(
        0,
        MAX_RECENT,
      ),
    );
  }

  /** The recent repos the current login can see, most recent first. */
  async #recent(token: string): Promise<RepoSummary[]> {
    const names = (await this.deps.recent.get()).slice(0, MAX_RECENT);
    const found = await Promise.all(
      names.map(async (fullName) => {
        const known = this.#known.get(fullName.toLowerCase());
        if (known) return known;
        const name = parseFullName(fullName);
        if (!name) return null;
        try {
          const res = await this.deps.fetch(`${GITHUB_API}/repos/${name.owner}/${name.repo}`, {
            headers: githubHeaders(token),
          });
          // Gone, or not visible to this login: left out (and kept, for another login).
          const repo = res.ok ? toRepoSummary(await res.json()) : null;
          if (repo) this.#known.set(fullName.toLowerCase(), repo);
          return repo;
        } catch {
          return null;
        }
      }),
    );
    const seen = new Set<string>();
    return found.filter((r): r is RepoSummary => {
      if (!r || seen.has(r.fullName.toLowerCase())) return false;
      seen.add(r.fullName.toLowerCase());
      return true;
    });
  }
}
