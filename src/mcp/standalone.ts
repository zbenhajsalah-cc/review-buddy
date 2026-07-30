/**
 * Standalone submit_review handling — for harnesses without a PreToolUse
 * equivalent (Cursor, VS Code Copilot, Codex). Here the tool call itself does
 * what the Claude Code hook does: validate, capture the diff, serve the
 * viewer, open the browser.
 *
 * Two modes, selected by a CLI flag on the server command (see mode.ts):
 *  - `--standalone` (detached): return the URL immediately and keep the viewer
 *    alive inside the long-lived MCP server process. Required for Cursor
 *    (cancels MCP calls at ~5 min) and VS Code Copilot (tool timeout not
 *    configurable) — a human review can't fit inside a tool call.
 *  - `--standalone=blocking`: await the reviewer's verdict before returning,
 *    mirroring the Claude Code hook block. Only for harnesses with a
 *    configurable tool-call timeout (Codex: `tool_timeout_sec`).
 *
 * No flag = off: the handler is the Phase-1 ack for the hook flow.
 */
import { isAbsolute } from "node:path";
import { repoToplevel } from "../server/git.ts";
import type { RunningServer } from "../server/http.ts";
import {
  openReviewSession,
  requestChangesMessage,
  resolutionNotesMessage,
} from "../server/session.ts";
import { validateAgentReview } from "../server/validate.ts";
import type { AgentReview } from "../types/review.ts";
import type { StandaloneMode } from "./mode.ts";

export interface ToolResult {
  // Index signature keeps this assignable to the MCP SDK's ServerResult union.
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const err = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Append resolution notes to a tool-result string when there are any. */
function withNotes(text: string, warnings: readonly string[]): string {
  const notes = resolutionNotesMessage(warnings);
  return notes ? `${text}\n\n${notes}` : text;
}

// The live review's server — superseded (stopped) when a new review arrives,
// so at most one viewer is live per MCP session. `stop()` also settles the
// server's `done` promise, so a blocking call awaiting it unblocks.
let current: RunningServer | undefined;

/** Stop the live viewer, if any, unblocking a pending blocking review. */
export function stopCurrentSession(): void {
  current?.stop();
  current = undefined;
}

/**
 * Build an idempotent shutdown that stops the live viewer then exits. The MCP
 * server wires this to client-disconnect + termination signals so a detached
 * standalone review can't outlive its client — otherwise a closed stdio pipe
 * (e.g. an editor reload) would leak the loopback port and a token-gated viewer
 * of the last diff. `exit` is injected for testability.
 */
export function makeShutdown(exit: (code: number) => void = process.exit): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    stopCurrentSession();
    exit(0);
  };
}

/** `value` must be an absolute path inside a git work tree; returns its repo root. */
function requireRepo(value: string, label: string): string {
  if (!isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path (got ${JSON.stringify(value)}).`);
  }
  const top = repoToplevel(value);
  if (!top) throw new Error(`${label} (${value}) is not inside a git repository.`);
  return top;
}

/**
 * Resolve the repo directory for a standalone review, where no hook event
 * supplies a cwd. Precedence: the agent's `cwd` field (the prompt tells it to
 * pass `git rev-parse --show-toplevel`) → REVIEW_BUDDY_CWD (e.g. VS Code sets
 * ${workspaceFolder}) → the MCP server process cwd. An explicit candidate that
 * isn't a repo is an error, not a fallthrough — silently reviewing some other
 * directory would violate "never fabricate".
 */
export function resolveStandaloneCwd(agentCwd?: string): string {
  if (agentCwd) return requireRepo(agentCwd, "the review's `cwd` field");
  const envCwd = process.env.REVIEW_BUDDY_CWD;
  if (envCwd) return requireRepo(envCwd, "REVIEW_BUDDY_CWD");
  const top = repoToplevel(process.cwd());
  if (top) return top;
  throw new Error(
    "Could not locate the repository: pass the repo root in the review's `cwd` field " +
      "(run `git rev-parse --show-toplevel`), or set REVIEW_BUDDY_CWD in the MCP server config.",
  );
}

/**
 * Run submit_review in standalone mode. Errors come back as isError tool
 * results (not throws) so the model can read the reason and retry — unlike
 * Claude Code, other harnesses may not validate against inputSchema first.
 */
export async function handleStandaloneSubmit(
  input: unknown,
  mode: Exclude<StandaloneMode, "off">,
): Promise<ToolResult> {
  const invalid = validateAgentReview(input);
  if (invalid) return err(`Invalid review payload — fix and resubmit: ${invalid}`);
  const agent = input as AgentReview;

  let cwd: string;
  try {
    cwd = resolveStandaloneCwd(agent.cwd);
  } catch (e) {
    return err(errMsg(e));
  }

  // Open the new session BEFORE stopping the previous one: if capture fails
  // (missing gh, bad source.ref, …) the reviewer keeps the viewer they had.
  // Ports are ephemeral, so the brief overlap can't collide.
  let server: RunningServer;
  try {
    // Blocking exists to return the verdict, so the verdict UI is forced on.
    server = await openReviewSession(agent, cwd, mode === "blocking" ? { roundtrip: true } : {});
  } catch (e) {
    return err(`Review Buddy could not open the review: ${errMsg(e)}`);
  }
  stopCurrentSession();
  current = server;

  if (mode === "detached") {
    return ok(
      withNotes(
        `Review opened in the reviewer's browser: ${server.url} — it stays available until the ` +
          `next submit_review or the end of this session. Tell the user the review is ready ` +
          `(include the URL in case no browser opened), then continue; no verdict is returned.`,
        server.warnings,
      ),
    );
  }

  // blocking: hold the tool call open until the reviewer clicks Done — or a
  // newer submit_review supersedes this one (stop() settles `done`).
  const result = await server.done;
  if (current === server) current = undefined;
  const { warnings } = server;
  server.stop();
  if (result.superseded) {
    // Superseded reviews were replaced before the reviewer finished — their
    // resolution notes are noise for the agent that never got a verdict.
    return ok(
      "This review was superseded by a newer submit_review call; no verdict was collected.",
    );
  }
  if (result.verdict === "request_changes") {
    return ok(withNotes(requestChangesMessage(result.summary), warnings));
  }
  return ok(withNotes("Review complete — the reviewer finished walking through it.", warnings));
}
