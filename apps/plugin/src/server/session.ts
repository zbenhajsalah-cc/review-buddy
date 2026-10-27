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
import { localGitSource } from "@review-buddy/core/node/local-source";
import { resolveReview } from "@review-buddy/core/resolve";
import type { AgentReview } from "@review-buddy/core/types";
import { pluginRoot } from "../plugin-root.ts";
import { openBrowser } from "./browser.ts";
import { type RunningServer, startServer } from "./http.ts";

function uiDir(): string | undefined {
  const root = pluginRoot();
  if (!root) return undefined;
  const dir = join(root, "ui", "dist");
  return existsSync(join(dir, "index.html")) ? dir : undefined;
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
  // Capture the authoritative diff (source B) matching what the agent reviewed;
  // the same source then serves full-file reads (source C).
  const source = localGitSource(cwd, agent.source, process.env.REVIEW_BUDDY_BASE);
  const diff = await source.diff();
  const pr = await source.pr();
  const { review, warnings } = resolveReview(
    agent,
    diff,
    buildMeta({ generatedBy: process.env.REVIEW_BUDDY_MODEL ?? "claude" }),
    pr,
  );
  for (const w of warnings) console.error(`[review-buddy] ${w}`);
  if (source.headRef === null) {
    console.error("[review-buddy] PR head not fetchable — full-file expansion disabled.");
  }

  const server = startServer({
    review,
    cwd,
    source,
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
