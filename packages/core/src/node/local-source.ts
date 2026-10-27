/**
 * ReviewDataSource over a local repo (the plugin's capture path). Which diff it
 * captures follows the agent's `source` — the tool/hook can't see `/review`'s
 * arguments, so without it a PR review would re-capture the local working tree
 * (empty) and render no hunks.
 */
import type { ReviewDataSource } from "../source.ts";
import type { ReviewSource } from "../types.ts";
import {
  assertSafeRef,
  captureDiff,
  capturePr,
  capturePrDiff,
  ensureCommit,
  fileContent,
  prBaseRef,
  resolveBase,
} from "./git.ts";

export interface LocalGitSource extends ReviewDataSource {
  /** Diff base ref — also the base side for full-file reads. */
  readonly base: string;
  /**
   * Head side for full-file reads (see fileContent): SHA = the PR head commit;
   * null = PR mode but the commit is unavailable (head reads return "", never
   * the worktree); undefined = worktree/branch mode (read the working tree).
   */
  readonly headRef?: string | null;
}

/**
 * Open a source for `cwd`. PR mode resolves its metadata, head commit, and
 * merge base here, once per review (not per file request). `baseOverride`
 * replaces HEAD as the worktree-mode base. Throws on unsafe refs.
 */
export function localGitSource(
  cwd: string,
  source: ReviewSource = { type: "worktree" },
  baseOverride?: string,
): LocalGitSource {
  if (source.type === "pr" && source.ref) {
    const ref = source.ref;
    const pr = capturePr(cwd, "HEAD", ref);
    // The PR's reviewed state is a commit, not the local working tree. Fetch it
    // once; null = unavailable, in which case full-file expansion is disabled
    // rather than leaking worktree bytes.
    const headRef = pr.headRefOid && ensureCommit(cwd, pr.headRefOid, ref) ? pr.headRefOid : null;
    // Base side: merge-base of the PR head and its base branch when we have the
    // head SHA; otherwise keep the base branch name.
    const base = typeof headRef === "string" ? prBaseRef(cwd, headRef, pr.base) : pr.base;
    return {
      base,
      headRef,
      diff: async () => capturePrDiff(cwd, ref),
      pr: async () => pr,
      fileContent: async (path, side) => fileContent(cwd, path, side, base, headRef),
    };
  }

  let base: string;
  if (source.type === "branch" && source.ref) {
    assertSafeRef(source.ref); // ref flows into `git diff <ref>` — block flag smuggling
    base = source.ref;
  } else {
    base = resolveBase(cwd, baseOverride);
  }
  return {
    base,
    diff: () => captureDiff(cwd, base),
    pr: async () => capturePr(cwd, base),
    fileContent: async (path, side) => fileContent(cwd, path, side, base),
  };
}
