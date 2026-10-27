/**
 * Shared review-session lifecycle: capture the authoritative diff (source B),
 * resolve the agent's narrative (source A) onto it, serve the viewer, open the
 * browser. Two entry points share this module:
 *
 *  - Claude Code: the PreToolUse hook (src/cli/index.ts) opens a session and
 *    BLOCKS on `server.done` before answering the hook event.
 *  - Other harnesses (Cursor, VS Code Copilot, Codex): the MCP server runs in
 *    standalone mode (src/mcp/server.ts) — `submit_review` itself opens a
 *    session and returns the URL, keeping the viewer alive in the MCP process.
 *
 * All progress goes to stderr: for the hook that's the transcript, for the MCP
 * server stderr is the only stream that doesn't corrupt the stdio protocol.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildMeta } from "@review-buddy/core/meta";
import { resolveReview } from "@review-buddy/core/resolve";
import type { AgentReview } from "@review-buddy/core/types";
import { openBrowser } from "./browser.ts";
import {
  assertSafeRef,
  captureDiff,
  capturePr,
  capturePrDiff,
  ensureCommit,
  prBaseRef,
  resolveBase,
} from "./git.ts";
import { type RunningServer, startServer } from "./http.ts";

const repoRoot = join(import.meta.dir, "..", "..");

function uiDir(): string | undefined {
  const dir = join(repoRoot, "src", "ui", "dist");
  return existsSync(join(dir, "index.html")) ? dir : undefined;
}

/**
 * Capture the authoritative diff (source B) matching what the agent reviewed.
 * `agent.source` tells us which — the tool/hook can't see `/review`'s
 * arguments, so without this a PR review would re-capture the local working
 * tree (empty) and render no hunks. `base` is the ref used for full-file
 * expansion (source C).
 */
export async function captureForSource(
  agent: AgentReview,
  cwd: string,
): Promise<{
  diff: string;
  pr: ReturnType<typeof capturePr>;
  base: string;
  headRef?: string | null;
}> {
  const source = agent.source ?? { type: "worktree" };

  if (source.type === "pr" && source.ref) {
    const pr = capturePr(cwd, "HEAD", source.ref);
    // The PR's reviewed state is a commit, not the local working tree. Fetch it
    // once (at session startup, not per-request); null = unavailable, in which
    // case full-file expansion is disabled rather than leaking worktree bytes.
    const headRef =
      pr.headRefOid && ensureCommit(cwd, pr.headRefOid, source.ref) ? pr.headRefOid : null;
    // Base side: merge-base of the PR head and its base branch when we have the
    // head SHA; otherwise keep the base branch name.
    const base = typeof headRef === "string" ? prBaseRef(cwd, headRef, pr.base) : pr.base;
    return { diff: capturePrDiff(cwd, source.ref), pr, base, headRef };
  }

  let base: string;
  if (source.type === "branch" && source.ref) {
    assertSafeRef(source.ref); // ref flows into `git diff <ref>` — block flag smuggling
    base = source.ref;
  } else {
    base = resolveBase(cwd, process.env.REVIEW_BUDDY_BASE);
  }
  return { diff: await captureDiff(cwd, base), pr: capturePr(cwd, base), base };
}

export interface SessionOptions {
  /**
   * Show the verdict (approve / request changes) UI. Default: the
   * REVIEW_BUDDY_ROUNDTRIP env flag. Standalone blocking mode forces it on —
   * its whole point is returning the verdict to the agent.
   */
  roundtrip?: boolean;
}

/**
 * Capture + resolve + serve + open the browser. Returns the running server;
 * the caller decides whether to await `server.done` (blocking flows) or return
 * immediately (standalone detached mode). Throws on capture/resolve errors.
 */
export async function openReviewSession(
  agent: AgentReview,
  cwd: string,
  opts: SessionOptions = {},
): Promise<RunningServer> {
  const { diff, pr, base, headRef } = await captureForSource(agent, cwd);
  const { review, warnings } = resolveReview(
    agent,
    diff,
    buildMeta({ generatedBy: process.env.REVIEW_BUDDY_MODEL ?? "claude" }),
    pr,
  );
  for (const w of warnings) console.error(`[review-buddy] ${w}`);
  if (headRef === null) {
    console.error("[review-buddy] PR head not fetchable — full-file expansion disabled.");
  }

  const server = startServer({
    review,
    cwd,
    baseRef: base,
    headRef,
    uiDir: uiDir(),
    roundtrip: opts.roundtrip ?? !!process.env.REVIEW_BUDDY_ROUNDTRIP,
  });
  console.error(`[review-buddy] Review ready at ${server.url}`);
  if (process.env.REVIEW_BUDDY_NO_OPEN) {
    console.error(`[review-buddy] REVIEW_BUDDY_NO_OPEN set — not opening a browser.`);
  } else if (!openBrowser(server.url)) {
    console.error(`[review-buddy] Could not open a browser — open the URL above manually.`);
  }
  return server;
}
