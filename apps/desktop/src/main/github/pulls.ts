/**
 * The open pull requests of a repository (US-14), for the PR list:
 *
 *   GET /repos/{o}/{r}/pulls?state=open&sort=updated&direction=desc&per_page=30&page={n}
 *   GET /repos/{o}/{r}/pulls/{n}       the size of each (the list has none)
 *
 * Sizes are read 8 at a time and kept per PR head, so a refresh reads only
 * PRs that changed. A size that cannot be read (or takes over 10 s) is left
 * out; the list still shows. Each PR also says which review the app has for it, if any.
 *
 * Dependencies are passed in (no Electron import), so this is tested with bun.
 */
import type { GitHubListError, PullPage, PullSummary } from "../../shared/ipc.ts";
import { GITHUB_API, githubHeaders } from "./auth.ts";
import { checkPage, getListPage, type ListCallDeps } from "./list-call.ts";
import { parseFullName } from "./repos.ts";

export const PULLS_PER_PAGE = 30;
const SIZE_READS_AT_ONCE = 8;
const SIZE_TIMEOUT_MS = 10_000;
/** Sizes kept (per PR head) before the cache starts over. */
const MAX_SIZES = 2000;

type Size = NonNullable<PullSummary["size"]>;

export interface GitHubPullsDeps extends ListCallDeps {
  /** The newest review the app has for `owner/repo#123`. */
  reviewOf(label: string): PullSummary["review"];
  /** How long one size read may take (tests shorten it). */
  sizeTimeoutMs?: number;
}

/** A PR of GitHub's list JSON, or null if a field the list needs is missing. */
export function toPullSummary(json: unknown): Omit<PullSummary, "size" | "review"> | null {
  const p = json as {
    number?: unknown;
    title?: unknown;
    user?: { login?: unknown } | null;
    updated_at?: unknown;
    draft?: unknown;
    html_url?: unknown;
    head?: { sha?: unknown } | null;
    requested_reviewers?: unknown;
  } | null;
  if (
    !p ||
    typeof p.number !== "number" ||
    !Number.isSafeInteger(p.number) ||
    p.number < 1 ||
    typeof p.title !== "string" ||
    typeof p.head?.sha !== "string" ||
    !/^[0-9a-f]{40}$/.test(p.head.sha)
  ) {
    return null;
  }
  return {
    number: p.number,
    title: p.title,
    author: typeof p.user?.login === "string" ? p.user.login : "unknown",
    updatedAt: typeof p.updated_at === "string" ? p.updated_at : "",
    draft: p.draft === true,
    url: typeof p.html_url === "string" ? p.html_url : "",
    headSha: p.head.sha,
    requestedReviewers: toLogins(p.requested_reviewers),
  };
}

/** The logins of a `requested_reviewers` array; anything else is no request. */
export function toLogins(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((r) => (r as { login?: unknown } | null)?.login)
    .filter((login): login is string => typeof login === "string" && login !== "");
}

/** The size fields of a single PR's JSON, or null. */
export function toSize(json: unknown): Size | null {
  const p = json as { additions?: unknown; deletions?: unknown; changed_files?: unknown } | null;
  const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (!p || !count(p.additions) || !count(p.deletions) || !count(p.changed_files)) return null;
  return {
    additions: p.additions as number,
    deletions: p.deletions as number,
    changedFiles: p.changed_files as number,
  };
}

export class GitHubPulls {
  /** By `owner/repo#n@headSha`, lower case. */
  #sizes = new Map<string, Size>();

  constructor(private readonly deps: GitHubPullsDeps) {}

  async list(fullName: unknown, page: unknown): Promise<PullPage | GitHubListError> {
    const name = parseFullName(fullName);
    if (!name) throw new Error(`Not a repository: ${String(fullName)}`);
    const n = checkPage(page);
    const repo = `${name.owner}/${name.repo}`;
    const repoUrl = `${GITHUB_API}/repos/${name.owner}/${name.repo}`;
    const answer = await getListPage(
      this.deps,
      `${repoUrl}/pulls?state=open&sort=updated&direction=desc&per_page=${PULLS_PER_PAGE}&page=${n}`,
      `the pull requests of ${repo}`,
      `${repo}: not found, or the token cannot see it.`,
    );
    if (!answer.ok) return answer;

    const pulls: PullSummary[] = answer.items
      .map(toPullSummary)
      .filter((p): p is PullSummary => p !== null);
    await eachLimited(pulls, SIZE_READS_AT_ONCE, async (pull) => {
      const key = `${repo}#${pull.number}@${pull.headSha}`.toLowerCase();
      let size = this.#sizes.get(key);
      if (!size) {
        size = (await this.#readSize(`${repoUrl}/pulls/${pull.number}`, answer.token)) ?? undefined;
        if (size) {
          if (this.#sizes.size >= MAX_SIZES) this.#sizes.clear();
          this.#sizes.set(key, size);
        }
      }
      if (size) pull.size = size;
      const review = this.deps.reviewOf(`${repo}#${pull.number}`);
      if (review) pull.review = review;
    });
    return { ok: true, repo, page: n, pulls, hasMore: answer.hasMore };
  }

  async #readSize(url: string, token: string): Promise<Size | null> {
    try {
      const res = await this.deps.fetch(url, {
        headers: githubHeaders(token),
        signal: AbortSignal.timeout(this.deps.sizeTimeoutMs ?? SIZE_TIMEOUT_MS),
      });
      return res.ok ? toSize(await res.json()) : null;
    } catch {
      return null;
    }
  }
}

/** Runs `step` on every item, at most `limit` at a time. */
async function eachLimited<T>(
  items: T[],
  limit: number,
  step: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await step(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
