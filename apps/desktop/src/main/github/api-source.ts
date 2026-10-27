/**
 * `ReviewDataSource` over the GitHub REST API (US-11): review a PR without a
 * local clone. Sources B and C, like LocalGitSource in core, but from GitHub:
 *
 *   PR metadata  GET /repos/{o}/{r}/pulls/{n}                    (JSON)
 *   diff         GET /repos/{o}/{r}/pulls/{n}                    (application/vnd.github.diff)
 *   merge base   GET /repos/{o}/{r}/compare/{base}...{head}?per_page=1&page=2
 *                (the file list is only on page 1, so page 2 is small)
 *   file bytes   GET /repos/{o}/{r}/contents/{path}?ref={sha}    (application/vnd.github.raw+json)
 *
 * Never a partial diff shown as complete: GitHub refuses the diff of a very
 * large PR (406 "too_large"), and any diff whose file count or line totals
 * differ from the PR's own numbers is rejected too. For a PR that large,
 * `largeDiff` (US-19: git, from a local copy) gives the diff instead, and the
 * same check applies.
 *
 * Dependencies are passed in (no Electron import), so this is tested with bun
 * against recorded responses (fixtures/).
 */
import { type ParsedFile, parseDiff } from "@review-buddy/core/diff";
import type { ReviewDataSource } from "@review-buddy/core/source";
import type { PrMetadata } from "@review-buddy/core/types";
import { type FetchFn, GITHUB_API, githubHeaders } from "./auth.ts";

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export interface GitHubApiSource extends ReviewDataSource {
  readonly ref: PrRef;
  /** The PR head commit: the head side of file reads. */
  readonly headSha: string;
  /** Merge base of the PR's base and head: the base side of file reads. */
  readonly baseSha: string;
  /** The diff's files, as a saved review keeps them for its file reads. */
  files(): Promise<DiffFileInfo[]>;
}

/** What a file read needs from the diff: the names, the kind of change, binary. */
export type DiffFileInfo = Pick<ParsedFile, "path" | "oldPath" | "changeType" | "binary">;

interface GitHubDeps {
  fetch: FetchFn;
  token: () => Promise<string>;
  /** Cancels every request (the user stopped the review). */
  signal?: AbortSignal;
}

/** What `largeDiff` gets: the PR, its two commits, and whether it is public. */
export interface LargePr {
  ref: PrRef;
  headSha: string;
  /** The merge base. */
  baseSha: string;
  /** GitHub says the repository is public (git then needs no token). */
  isPublic: boolean;
}

export interface OpenDeps extends GitHubDeps {
  /**
   * The diff of a PR too large for GitHub's diff API, from elsewhere (a local
   * copy, US-19). It is checked against the PR's numbers like GitHub's own.
   */
  largeDiff?: (pr: LargePr) => Promise<string>;
}

/** GETs on one repository with the app's token, and errors in words. */
function repoCalls(ref: PrRef, deps: GitHubDeps) {
  const repoUrl = `${GITHUB_API}/repos/${ref.owner}/${ref.repo}`;
  const label = `${ref.owner}/${ref.repo}#${ref.number}`;
  const get = async (url: string, accept?: string): Promise<Response> => {
    const headers = githubHeaders(await deps.token());
    if (accept) headers.accept = accept;
    try {
      return await deps.fetch(url, { headers, signal: deps.signal });
    } catch (e) {
      throw new Error(`Could not reach GitHub (${e instanceof Error ? e.message : String(e)}).`);
    }
  };
  const fail = async (res: Response, what: string): Promise<never> => {
    const message = await errorMessage(res);
    if (res.status === 404)
      throw new Error(`${what}: not found, or the token cannot see ${label}.`);
    throw new Error(`${what}: GitHub answered ${res.status}${message ? ` (${message})` : ""}.`);
  };
  return { repoUrl, label, get, fail };
}

/**
 * Source C over the GitHub API: the bytes of the PR's own files at its head
 * or merge base. An open PR uses it, and so does a saved review (US-16),
 * which keeps the file list and the two SHAs.
 */
export function prFileReader(
  prRef: PrRef,
  shas: { headSha: string; baseSha: string },
  files: () => Promise<Map<string, DiffFileInfo>>,
  deps: GitHubDeps,
): ReviewDataSource["fileContent"] {
  const ref = parsePrRef(prRef);
  if (!SHA.test(shas.headSha) || !SHA.test(shas.baseSha)) throw new Error("Not commit SHAs.");
  const { repoUrl, get, fail } = repoCalls(ref, deps);
  return async (path, side) => {
    // Only the PR's own files (the same set as allowedPaths of the resolved
    // review: resolution keeps every diff file).
    const file = (await files()).get(path);
    if (!file) throw new Error(`unknown path: ${path}`);
    if (file.binary) return "";
    if (side === "head" && file.changeType === "deleted") return "";
    if (side === "base" && file.changeType === "added") return "";
    // A renamed file has its old name on the base side.
    const repoPath = side === "base" ? (file.oldPath ?? path) : path;
    const sha = side === "base" ? shas.baseSha : shas.headSha;
    const res = await get(
      `${repoUrl}/contents/${encodePath(repoPath)}?ref=${sha}`,
      "application/vnd.github.raw+json",
    );
    if (res.status === 404) return "";
    if (!res.ok) await fail(res, `${repoPath} at ${sha.slice(0, 7)}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) return "";
    const text = await res.text();
    return text.length > MAX_FILE_BYTES ? "" : text;
  };
}

/** GitHub will not send this PR's diff: too many files or lines. */
export class PrTooLargeError extends Error {}
/** The diff GitHub sent does not match the PR: not shown, never as complete. */
export class IncompleteDiffError extends Error {}

/** Bigger files are not expanded (the viewer would not cope anyway). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;

/** A GitHub owner or repository name that is safe in a URL path. */
export function isRepoName(s: string): boolean {
  return NAME.test(s) && s !== "." && s !== "..";
}

/** Checks a PR reference before it goes into a URL. */
export function parsePrRef(ref: PrRef): PrRef {
  const { owner, repo, number } = ref;
  if (!isRepoName(owner) || !isRepoName(repo)) {
    throw new Error(`Not a GitHub repository: ${owner}/${repo}`);
  }
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`Not a PR number: ${number}`);
  return { owner, repo, number };
}

/** A repo path as URL path segments, each encoded; no empty, "." or ".." segment. */
export function encodePath(path: string): string {
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new Error(`Unsafe path: ${path}`);
  }
  return parts.map(encodeURIComponent).join("/");
}

interface PullJson {
  title?: string;
  body?: string | null;
  user?: { login?: string } | null;
  created_at?: string;
  html_url?: string;
  changed_files?: number;
  additions?: number;
  deletions?: number;
  base?: { ref?: string; sha?: string; repo?: { private?: boolean } | null };
  head?: { ref?: string; sha?: string };
}

/**
 * Opens a PR: reads its metadata and merge base once. The diff is read on the
 * first `diff()` (and kept), file bytes on demand.
 */
export async function openGitHubPr(prRef: PrRef, deps: OpenDeps): Promise<GitHubApiSource> {
  const ref = parsePrRef(prRef);
  const { repoUrl, label, get, fail } = repoCalls(ref, deps);

  // 1. Metadata.
  const prRes = await get(`${repoUrl}/pulls/${ref.number}`);
  if (!prRes.ok) await fail(prRes, `PR ${label}`);
  const pull = (await prRes.json()) as PullJson;
  const headSha = pull.head?.sha ?? "";
  const baseTip = pull.base?.sha ?? "";
  if (!SHA.test(headSha) || !SHA.test(baseTip))
    throw new Error(`PR ${label}: GitHub sent no commit SHAs.`);
  const pr: PrMetadata = {
    title: pull.title ?? label,
    description: pull.body ?? "",
    author: pull.user?.login ?? "unknown",
    createdAt: pull.created_at ?? new Date().toISOString(),
    base: pull.base?.ref ?? "",
    head: pull.head?.ref ?? "",
    url: pull.html_url,
    headRefOid: headSha,
  };

  // 2. Merge base: the PR diff is against it, so base-side bytes come from it.
  const cmpRes = await get(`${repoUrl}/compare/${baseTip}...${headSha}?per_page=1&page=2`);
  if (!cmpRes.ok) await fail(cmpRes, `Merge base of ${label}`);
  const baseSha = ((await cmpRes.json()) as { merge_base_commit?: { sha?: string } })
    .merge_base_commit?.sha;
  if (!baseSha || !SHA.test(baseSha)) throw new Error(`${label}: GitHub sent no merge base.`);

  // 3. The diff, checked against the PR's own numbers.
  let diffLoad: Promise<{ raw: string; files: Map<string, ParsedFile> }> | null = null;
  const loadDiff = () => {
    diffLoad ??= (async () => {
      const res = await get(`${repoUrl}/pulls/${ref.number}`, "application/vnd.github.diff");
      let raw: string;
      if (res.ok) {
        raw = await res.text();
      } else {
        const body = await res.text();
        if (!isTooLarge(res.status, body)) {
          throw new Error(`Diff of ${label}: GitHub answered ${res.status}.`);
        }
        const why = `${label} is too large for GitHub's diff API (${errorText(body) || res.status})`;
        if (!deps.largeDiff) throw new PrTooLargeError(`${why}. Reviewing it needs a local clone.`);
        try {
          // A public repository is one GitHub says is public; else git gets the token.
          const isPublic = pull.base?.repo?.private === false;
          raw = await deps.largeDiff({ ref, headSha, baseSha, isPublic });
        } catch (e) {
          if (deps.signal?.aborted) throw e;
          throw new PrTooLargeError(
            `${why}, and the local copy did not work: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      const parsed = parseDiff(raw);
      checkComplete(label, pull, parsed);
      return { raw, files: new Map(parsed.map((f) => [f.path, f])) };
    })();
    // A failed load is retried on the next call.
    diffLoad.catch(() => {
      diffLoad = null;
    });
    return diffLoad;
  };

  return {
    ref,
    headSha,
    baseSha,
    diff: async () => (await loadDiff()).raw,
    pr: async () => pr,
    files: async () =>
      [...(await loadDiff()).files.values()].map(({ path, oldPath, changeType, binary }) =>
        oldPath === undefined
          ? { path, changeType, binary }
          : { path, oldPath, changeType, binary },
      ),
    fileContent: prFileReader(
      ref,
      { headSha, baseSha },
      async () => (await loadDiff()).files,
      deps,
    ),
  };
}

/**
 * GitHub answers 406 (sometimes 422) with code "too_large" when it will not
 * build a PR's diff ("Sorry, the diff exceeded the maximum number of files
 * (300)…" or "… lines (20000)").
 */
function isTooLarge(status: number, body: string): boolean {
  if (status === 406) return true;
  return (
    (status === 422 || status === 403) && /too_large|too large|exceeded the maximum/i.test(body)
  );
}

/** The PR's file count and line totals must match the diff exactly. */
function checkComplete(label: string, pull: PullJson, files: ParsedFile[]): void {
  const got = {
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
  const want = {
    files: pull.changed_files,
    additions: pull.additions,
    deletions: pull.deletions,
  };
  if (
    got.files === want.files &&
    got.additions === want.additions &&
    got.deletions === want.deletions
  ) {
    return;
  }
  const show = (s: { files?: number; additions?: number; deletions?: number }) =>
    `${s.files} files, +${s.additions} −${s.deletions}`;
  throw new IncompleteDiffError(
    `The diff GitHub sent for ${label} (${show(got)}) does not match the PR (${show(want)}). ` +
      "The PR may have changed while loading, or GitHub cut the diff. Try again; a partial diff is never shown.",
  );
}

/** The `message` of a GitHub error answer, or "". */
export async function errorMessage(res: Response): Promise<string> {
  try {
    return errorText(await res.text());
  } catch {
    return "";
  }
}

function errorText(body: string): string {
  try {
    const message = (JSON.parse(body) as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  } catch {
    return "";
  }
}
