/**
 * Source B + C capture: the authoritative diff, PR metadata, and full file
 * contents — all read from the local repo in the hook's cwd. Non-mutating:
 * never stages, commits, or resets the user's working tree.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import type { PrMetadata } from "../types.ts";

/** git's hash of the empty tree — used to diff a repo with no commits yet. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const MAX_BUFFER = 1024 * 1024 * 128;
const execFileAsync = promisify(execFile);

function run(cmd: string, cwd: string, args: string[], allowFail = false): string {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER });
  } catch (err) {
    // `git diff --no-index` exits 1 when files differ — expected, not an error.
    const stdout = (err as { stdout?: string }).stdout;
    if (allowFail) return typeof stdout === "string" ? stdout : "";
    throw err;
  }
}

async function runAsync(
  cmd: string,
  cwd: string,
  args: string[],
  allowFail = false,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout;
    if (allowFail) return typeof stdout === "string" ? stdout : "";
    throw err;
  }
}

// core.quotePath=false is global on purpose: every path this module reads from
// git (diff, ls-files, show, log) must arrive as raw UTF-8, never C-quoted, so
// special-character filenames survive capture. Do not narrow it to one call.
const git = (cwd: string, args: string[], allowFail = false) =>
  run("git", cwd, ["--no-pager", "-c", "core.quotePath=false", ...args], allowFail);
const gitAsync = (cwd: string, args: string[], allowFail = false) =>
  runAsync("git", cwd, ["--no-pager", "-c", "core.quotePath=false", ...args], allowFail);

/**
 * Guard against argv flag smuggling: `ref` originates in the agent's JSON (and,
 * for a PR, ultimately from untrusted branch/PR data). execFileSync blocks shell
 * injection but NOT a value like `--upload-pack=…` being read as a flag by git/gh.
 * A safe git ref can't start with `-`; a PR ref must be a bare number or a
 * github.com pull URL.
 */
const PR_REF_RE = /^(\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+)$/;

export function assertSafeRef(ref: string): void {
  if (!ref || ref.startsWith("-")) {
    throw new Error(`Refusing unsafe git ref: ${JSON.stringify(ref)}`);
  }
}

export function assertPrRef(ref: string): void {
  if (!PR_REF_RE.test(ref)) {
    throw new Error(
      `Refusing unsafe PR ref (want a number or github PR URL): ${JSON.stringify(ref)}`,
    );
  }
}

/** Resolve the diff base ref: explicit override, else HEAD, else empty tree. */
export function resolveBase(cwd: string, override?: string): string {
  if (override) {
    assertSafeRef(override);
    return override;
  }
  const hasHead = git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"], true).trim();
  return hasHead ? "HEAD" : EMPTY_TREE;
}

/**
 * Capture the working-tree diff against `base` (Phase 1 default base = HEAD =
 * uncommitted changes; pass a branch like "main" to review a whole branch).
 * Untracked, non-ignored files are folded in via `git diff --no-index` so they
 * appear as new-file diffs without touching the index.
 */
export async function captureDiff(cwd: string, base: string): Promise<string> {
  const tracked = await gitAsync(cwd, ["diff", "--no-color", base]);

  // -z = NUL-terminated raw paths: no C-quoting of special characters, so the
  // exact on-disk name reaches `git diff --no-index` below.
  const others = (await gitAsync(cwd, ["ls-files", "-z", "--others", "--exclude-standard"]))
    .split("\0")
    .filter(Boolean);

  // Fold untracked files via `git diff --no-index` — one spawn per file (the
  // command takes exactly two paths, so it can't be batched). Run them
  // concurrently (bounded) so an atypical repo with many untracked non-ignored
  // files doesn't stall the blocking hook. Order preserved for a stable diff.
  const LIMIT = 16;
  const parts: string[] = new Array(others.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= others.length) return;
      parts[i] = await gitAsync(
        cwd,
        ["diff", "--no-color", "--no-index", "--", "/dev/null", others[i]!],
        true,
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, others.length) }, worker));

  const untracked = parts.join("");
  if (!untracked) return tracked;
  const sep = tracked && !tracked.endsWith("\n") ? "\n" : "";
  return tracked + sep + untracked;
}

/**
 * The PR's diff via `gh pr diff <ref>` (ref = number, URL, or branch). Use this
 * — NOT `git diff` — when the agent reviewed a PR: the PR branch usually isn't
 * checked out locally, so a local `git diff` would be empty or unrelated. Throws
 * if gh is missing/unauthenticated or the PR can't be found (the caller fails
 * open, so the agent isn't blocked).
 */
export function capturePrDiff(cwd: string, ref: string): string {
  assertPrRef(ref);
  return run("gh", cwd, ["pr", "diff", ref], false);
}

interface GhPr {
  title?: string;
  body?: string;
  author?: { login?: string };
  createdAt?: string;
  baseRefName?: string;
  headRefName?: string;
  url?: string;
  headRefOid?: string;
}

/**
 * PR metadata (source B). Prefers `gh pr view` when a PR exists; otherwise
 * falls back to local git (branch name + last commit subject) so the
 * working-tree flow works with no GitHub remote. Pass `ref` (PR number/URL)
 * to target a specific PR — required when the branch isn't checked out.
 */
export function capturePr(cwd: string, base: string, ref?: string): PrMetadata {
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], true).trim() || "HEAD";

  const ghArgs = ["pr", "view"];
  if (ref) {
    assertPrRef(ref);
    ghArgs.push(ref);
  }
  ghArgs.push("--json", "title,body,author,createdAt,baseRefName,headRefName,url,headRefOid");
  const ghJson = run("gh", cwd, ghArgs, true).trim();

  if (ghJson.startsWith("{")) {
    try {
      const pr = JSON.parse(ghJson) as GhPr;
      return {
        title: pr.title ?? branch,
        description: pr.body ?? "",
        author: pr.author?.login ?? "unknown",
        createdAt: pr.createdAt ?? new Date().toISOString(),
        base: pr.baseRefName ?? base,
        head: pr.headRefName ?? branch,
        url: pr.url,
        headRefOid: pr.headRefOid,
      };
    } catch {
      /* fall through to git fallback */
    }
  }

  const subject = git(cwd, ["log", "-1", "--pretty=%s"], true).trim();
  const author = git(cwd, ["config", "user.name"], true).trim() || "unknown";
  return {
    title: subject || branch,
    description: "",
    author,
    createdAt: new Date().toISOString(),
    base,
    head: branch,
  };
}

/**
 * Make a commit reachable locally, fetching it if needed (PR head commits
 * usually aren't). Fail-open: returns false when the object can't be obtained
 * (offline, no remote) — callers degrade to empty content.
 */
export function ensureCommit(cwd: string, sha: string, prRef?: string): boolean {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return false;
  const have = () => {
    try {
      run("git", cwd, ["cat-file", "-e", `${sha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };
  if (have()) return true;
  // Prefer the PR ref (always fetchable on GitHub); fall back to the raw SHA.
  const prNumber = prRef?.match(/(\d+)$/)?.[1];
  if (prNumber) {
    run("git", cwd, ["fetch", "origin", `pull/${prNumber}/head`], true);
    if (have()) return true;
  }
  run("git", cwd, ["fetch", "origin", sha], true);
  return have();
}

/**
 * Best base for PR full-file expansion: merge-base of the PR head and the
 * base branch. Falls back to the branch name when anything fails (offline,
 * no remote) — callers keep today's behavior in that case.
 */
export function prBaseRef(cwd: string, headSha: string, baseBranch: string): string {
  assertSafeRef(baseBranch); // from GitHub API data — guard like other refs
  run("git", cwd, ["fetch", "origin", baseBranch], true);
  const mb = run("git", cwd, ["merge-base", headSha, `origin/${baseBranch}`], true).trim();
  return /^[0-9a-f]{40}$/i.test(mb) ? mb : baseBranch;
}

/**
 * Full file contents (source C) for "expand full file" + word-level context.
 * head = the working-tree bytes (worktree/branch mode) or the PR head commit's
 * bytes (PR mode, when `headRef` is a SHA); base = the file at the diff base
 * ref. `headRef` is tri-state: SHA = read that commit; null = PR mode but the
 * commit is unavailable, return "" (never the worktree); undefined = worktree
 * mode, read the working tree.
 */
export function fileContent(
  cwd: string,
  path: string,
  side: "base" | "head",
  baseRef: string,
  headRef?: string | null,
): string {
  if (side === "head") {
    // PR mode: the reviewed state is a commit, not the local working tree.
    if (headRef) {
      assertSafeRef(headRef); // consistency with the base side — headRef is API/agent-derived
      return git(cwd, ["show", `${headRef}:${path}`], true);
    }
    if (headRef === null) return ""; // PR mode, content unavailable — never leak worktree bytes
    const abs = join(cwd, path);
    if (!existsSync(abs)) return "";
    // abs may be (or pass through) a symlink pointing OUTSIDE the repo. The caller's
    // lexical isInside() can't catch that, since resolve() doesn't dereference
    // links. Realpath both sides and confirm containment before we read: a link
    // that escapes the repo must never be served as repo content.
    let real: string;
    let root: string;
    try {
      real = realpathSync(abs);
      root = realpathSync(cwd);
    } catch {
      return "";
    }
    if (real !== root && !real.startsWith(root + sep)) return "";
    return readFileSync(real, "utf8");
  }
  const ref = baseRef === EMPTY_TREE ? "" : baseRef;
  if (!ref) return "";
  assertSafeRef(ref);
  return git(cwd, ["show", `${ref}:${path}`], true);
}

/**
 * Absolute repo toplevel for `cwd`, or null when `cwd` doesn't exist or isn't
 * inside a git work tree. Used by the standalone MCP mode, where — unlike the
 * hook, which is handed the session cwd — the repo location must be validated
 * from the agent's `cwd` field / env / process.cwd().
 */
export function repoToplevel(cwd: string): string | null {
  if (!existsSync(cwd)) return null;
  try {
    const out = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
    return out || null;
  } catch {
    return null;
  }
}
